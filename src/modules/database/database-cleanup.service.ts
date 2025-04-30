import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../invoice/entities/invoice.entity';
import { InvoiceDetail } from '../invoice/entities/invoice-detail.entity';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DatabaseCleanupService {
    private readonly logger = new Logger(DatabaseCleanupService.name);
    private readonly logFile = path.join(process.cwd(), 'logs', 'database-cleanup.log');

    constructor(
        @InjectRepository(Invoice)
        private readonly invoiceRepository: Repository<Invoice>,
        @InjectRepository(InvoiceDetail)
        private readonly invoiceDetailRepository: Repository<InvoiceDetail>,
    ) {
        // 确保日志目录存在
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    private logOperation(message: string): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(this.logFile, logMessage);
        this.logger.log(message);
    }

    /**
     * 安全删除指定时间之前的数据
     * @param beforeDate 删除此日期之前的数据
     * @param batchSize 每批处理的数量
     * @returns 删除的记录数
     */
    async cleanupDataBeforeDate(beforeDate: Date, batchSize: number = 1000): Promise<{ invoices: number; details: number }> {
        this.logOperation(`Starting cleanup of data before ${beforeDate.toISOString()}`);

        let totalInvoices = 0;
        let totalDetails = 0;

        try {
            // 使用事务确保数据一致性
            await this.invoiceRepository.manager.transaction(async (manager) => {
                // 1. 先查询要删除的发票ID
                const invoiceIds = await manager
                    .createQueryBuilder()
                    .select('id')
                    .from(Invoice, 'invoice')
                    .where('created_at < :beforeDate', { beforeDate })
                    .getRawMany();

                const ids = invoiceIds.map(item => item.id);

                if (ids.length === 0) {
                    this.logOperation('No data found to delete');
                    return;
                }

                // 2. 分批删除发票明细
                for (let i = 0; i < ids.length; i += batchSize) {
                    const batchIds = ids.slice(i, i + batchSize);
                    const { affected: detailsAffected } = await manager
                        .createQueryBuilder()
                        .delete()
                        .from(InvoiceDetail)
                        .where('invoice_id IN (:...ids)', { ids: batchIds })
                        .execute();

                    totalDetails += detailsAffected || 0;
                    this.logOperation(`Deleted ${detailsAffected} invoice details in batch ${i / batchSize + 1}`);
                }

                // 3. 分批删除发票
                for (let i = 0; i < ids.length; i += batchSize) {
                    const batchIds = ids.slice(i, i + batchSize);
                    const { affected: invoicesAffected } = await manager
                        .createQueryBuilder()
                        .delete()
                        .from(Invoice)
                        .where('id IN (:...ids)', { ids: batchIds })
                        .execute();

                    totalInvoices += invoicesAffected || 0;
                    this.logOperation(`Deleted ${invoicesAffected} invoices in batch ${i / batchSize + 1}`);
                }
            });

            this.logOperation(`Cleanup completed. Deleted ${totalInvoices} invoices and ${totalDetails} invoice details`);
            return { invoices: totalInvoices, details: totalDetails };
        } catch (error) {
            this.logOperation(`Error during cleanup: ${error.message}`);
            throw error;
        }
    }

    /**
     * 安全删除指定状态的数据
     * @param status 要删除的状态
     * @param batchSize 每批处理的数量
     * @returns 删除的记录数
     */
    async cleanupDataByStatus(status: string, batchSize: number = 1000): Promise<{ invoices: number; details: number }> {
        this.logOperation(`Starting cleanup of data with status: ${status}`);

        let totalInvoices = 0;
        let totalDetails = 0;

        try {
            await this.invoiceRepository.manager.transaction(async (manager) => {
                const invoiceIds = await manager
                    .createQueryBuilder()
                    .select('id')
                    .from(Invoice, 'invoice')
                    .where('status = :status', { status })
                    .getRawMany();

                const ids = invoiceIds.map(item => item.id);

                if (ids.length === 0) {
                    this.logOperation('No data found to delete');
                    return;
                }

                // 分批删除发票明细
                for (let i = 0; i < ids.length; i += batchSize) {
                    const batchIds = ids.slice(i, i + batchSize);
                    const { affected: detailsAffected } = await manager
                        .createQueryBuilder()
                        .delete()
                        .from(InvoiceDetail)
                        .where('invoice_id IN (:...ids)', { ids: batchIds })
                        .execute();

                    totalDetails += detailsAffected || 0;
                    this.logOperation(`Deleted ${detailsAffected} invoice details in batch ${i / batchSize + 1}`);
                }

                // 分批删除发票
                for (let i = 0; i < ids.length; i += batchSize) {
                    const batchIds = ids.slice(i, i + batchSize);
                    const { affected: invoicesAffected } = await manager
                        .createQueryBuilder()
                        .delete()
                        .from(Invoice)
                        .where('id IN (:...ids)', { ids: batchIds })
                        .execute();

                    totalInvoices += invoicesAffected || 0;
                    this.logOperation(`Deleted ${invoicesAffected} invoices in batch ${i / batchSize + 1}`);
                }
            });

            this.logOperation(`Cleanup completed. Deleted ${totalInvoices} invoices and ${totalDetails} invoice details`);
            return { invoices: totalInvoices, details: totalDetails };
        } catch (error) {
            this.logOperation(`Error during cleanup: ${error.message}`);
            throw error;
        }
    }

    /**
     * 安全删除所有数据
     * @param batchSize 每批处理的数量
     * @returns 删除的记录数
     */
    async cleanupAllData(batchSize: number = 1000): Promise<{ invoices: number; details: number }> {
        this.logOperation('Starting cleanup of all data');

        let totalInvoices = 0;
        let totalDetails = 0;

        try {
            // 使用事务确保数据一致性
            await this.invoiceRepository.manager.transaction(async (manager) => {
                // 1. 先查询所有发票ID
                const invoiceIds = await manager
                    .createQueryBuilder()
                    .select('id')
                    .from(Invoice, 'invoice')
                    .getRawMany();

                const ids = invoiceIds.map(item => item.id);

                if (ids.length === 0) {
                    this.logOperation('No data found to delete');
                    return;
                }

                // 2. 分批删除发票明细
                for (let i = 0; i < ids.length; i += batchSize) {
                    const batchIds = ids.slice(i, i + batchSize);
                    const { affected: detailsAffected } = await manager
                        .createQueryBuilder()
                        .delete()
                        .from(InvoiceDetail)
                        .where('invoice_id IN (:...ids)', { ids: batchIds })
                        .execute();

                    totalDetails += detailsAffected || 0;
                    this.logOperation(`Deleted ${detailsAffected} invoice details in batch ${i / batchSize + 1}`);
                }

                // 3. 分批删除发票
                for (let i = 0; i < ids.length; i += batchSize) {
                    const batchIds = ids.slice(i, i + batchSize);
                    const { affected: invoicesAffected } = await manager
                        .createQueryBuilder()
                        .delete()
                        .from(Invoice)
                        .where('id IN (:...ids)', { ids: batchIds })
                        .execute();

                    totalInvoices += invoicesAffected || 0;
                    this.logOperation(`Deleted ${invoicesAffected} invoices in batch ${i / batchSize + 1}`);
                }
            });

            this.logOperation(`Cleanup completed. Deleted ${totalInvoices} invoices and ${totalDetails} invoice details`);
            return { invoices: totalInvoices, details: totalDetails };
        } catch (error) {
            this.logOperation(`Error during cleanup: ${error.message}`);
            throw error;
        }
    }
} 