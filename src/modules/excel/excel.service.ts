import { Injectable, Logger } from '@nestjs/common';
import { Workbook } from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../invoice/entities/invoice.entity';
import { InvoiceDetail } from '../invoice/entities/invoice-detail.entity';
import { TenantConfigService } from '../tenant/tenant-config.service';

@Injectable()
export class ExcelService {
    private readonly EXCEL_TEMPLATE = 'templates/invoice_report_template.xlsx';
    private readonly logger = new Logger(ExcelService.name);

    constructor(
        @InjectRepository(Invoice)
        private readonly invoiceRepository: Repository<Invoice>,
        @InjectRepository(InvoiceDetail)
        private readonly invoiceDetailRepository: Repository<InvoiceDetail>,
        private readonly tenantConfigService: TenantConfigService,

    ) { }



    /**
    * 生成epicorTenantCompany标识
    * @param serverBaseAPI Epicor API地址
    * @param companyID 公司ID
    */
    private generateEpicorTenantCompany(serverBaseAPI: string, companyID: string): string {
        try {
            // 从API地址中提取环境标识
            // 例如: https://simalfa.kineticcloud.cn/simalfaprod/api/v1 -> simalfaprod
            const url = new URL(serverBaseAPI);
            const pathParts = url.pathname.split('/').filter(part => part.length > 0);
            const environment = pathParts.find(part => part !== 'api' && part !== 'v1' && part !== 'v2') || 'default';

            return `${environment}_${companyID}`;
        } catch (error) {
            this.logger.warn(`Error parsing server API URL ${serverBaseAPI}: ${error.message}`);
            return `default_${companyID}`;
        }
    }

    async exportInvoices(epicorIds: string[], tenantId: string): Promise<string> {
        // Create output directory if it doesn't exist
        const outputDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        let epicorTenantCompany = '';
        if (tenantId) {
            const appConfig = await this.tenantConfigService.getAppConfigByTenantId(tenantId, 'einvoice');
            const company = appConfig?.settings?.serverSettings?.companyID;
            const serverBaseAPI = appConfig?.settings?.serverSettings?.serverBaseAPI;
            epicorTenantCompany = this.generateEpicorTenantCompany(
                serverBaseAPI,
                company
            );
        }

        const outputFilePath = path.join(outputDir, `invoice_export_${Date.now()}.xlsx`);

        // Load template
        const templatePath = process.env.NODE_ENV === "development" ? path.join(process.cwd(), 'src', this.EXCEL_TEMPLATE) : path.join(process.cwd(), this.EXCEL_TEMPLATE);
        const workbook = new Workbook();
        await workbook.xlsx.readFile(templatePath);

        // Get sheets
        const firstSheet = workbook.getWorksheet('1-发票基本信息');
        const secondSheet = workbook.getWorksheet('2-发票明细信息');

        // Fetch invoices and their details
        const invoices = await this.invoiceRepository
            .createQueryBuilder('invoice')
            .leftJoinAndSelect('invoice.invoiceDetails', 'details')
            .where('invoice.erp_invoice_id IN (:...ids)', { ids: epicorIds })
            .andWhere('invoice.epicor_tenant_company = :epicorTenantCompany', { epicorTenantCompany })
            .getMany();

        let currentRow = 4;
        let currentDetailRow = 4;
        for (const invoice of invoices) {
            this.fillFirstSheet(firstSheet, currentRow, invoice);

            // Fill details for each invoice
            for (const detail of invoice.invoiceDetails) {
                this.fillSecondSheet(secondSheet, currentDetailRow, detail);
                currentDetailRow++;
            }
            currentRow++;
        }

        // Save the file
        await workbook.xlsx.writeFile(outputFilePath);
        return outputFilePath;
    }

    private fillFirstSheet(sheet: any, currentRow: number, invoice: Invoice) {
        const row = sheet.getRow(currentRow);
        row.getCell(1).value = invoice.erpInvoiceId;
        row.getCell(2).value = invoice.erpInvoiceDescription;
        row.getCell(4).value = '是'; // isTaxIncluded
        row.getCell(6).value = invoice.customerName;
        row.getCell(8).value = invoice.customerResaleId;
        row.getCell(13).value = invoice.invoiceComment;
    }

    private fillSecondSheet(sheet: any, currentRow: number, detail: InvoiceDetail) {
        const row = sheet.getRow(currentRow);
        row.getCell(1).value = detail.erpInvoiceId;
        row.getCell(2).value = detail.lineDescription;
        row.getCell(3).value = detail.commodityCode;
        row.getCell(4).value = detail.uomDescription;
        row.getCell(5).value = detail.salesUm;
        row.getCell(6).value = this.getSellingShipQuantity(detail.sellingShipQty);
        row.getCell(7).value = detail.docUnitPrice;
        row.getCell(8).value = detail.docExtPrice;
        row.getCell(9).value = this.getTaxRegionCode(detail.taxPercent);
    }

    private getTaxRegionCode(taxPercent: number): string {
        if (!taxPercent) return '';
        return (taxPercent / 100).toString();
    }

    private getSellingShipQuantity(sellingShipQty: number): string {
        if (!sellingShipQty) return '';
        return Math.round(sellingShipQty).toString();
    }
} 