import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { EpicorConfig, EpicorResponse, EpicorInvoice, EpicorInvoiceHeader, ELIEInvoiceResetData, ELIEInvoiceResetOptions, ELIEInvoiceResetResult } from './interfaces/epicor.interface';

export interface EpicorTenantConfig {
  serverBaseAPI: string;
  companyID: string;
  userAccount: string;
  password?: string; // Password might be optional if other auth methods are used, but for Basic it's needed
  apiKey?: string; // Consider if API key is also per-tenant
}

@Injectable()
export class EpicorService {
  private readonly logger = new Logger(EpicorService.name);
  private readonly config: EpicorConfig;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.config = {
      baseUrl: this.configService.get<string>('EPICOR_BASE_URL', 'https://simalfa.kineticcloud.cn/simalfaprod/api/v1'),
      apiKey: this.configService.get<string>('EPICOR_API_KEY', ''),
      username: this.configService.get<string>('EPICOR_USERNAME', ''),
      password: this.configService.get<string>('EPICOR_PASSWORD', ''),
    };
  }

  /**
   * Sync invoices from Epicor
   * @param lastSyncDate Last sync date (optional, for incremental sync)
   * @returns List of invoices from Epicor
   */
  async syncInvoices(lastSyncDate?: Date): Promise<EpicorResponse> {
    try {
      this.logger.log(`Syncing invoices from Epicor since ${lastSyncDate?.toISOString() || 'all'}`);

      // Build URL for the Epicor API
      const url = `${this.config.baseUrl}/BaqSvc/InvReport(TC)`;

      // Add filter for incremental sync if lastSyncDate is provided
      let filter = '';
      if (lastSyncDate) {
        const formattedDate = lastSyncDate.toISOString();
        filter = `?$filter=OrderHed_OrderDate gt datetime'${formattedDate}'`;
      }

      // Set authorization headers
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      };

      // If API key is provided, add it to headers
      if (this.config.apiKey) {
        headers['X-API-Key'] = this.config.apiKey;
      }

      // Send HTTP request
      const response = await lastValueFrom(
        this.httpService.get<EpicorResponse>(`${url}${filter}`, { headers })
      );

      this.logger.log(`Retrieved ${response.data.value.length} invoices from Epicor`);
      this.logger.log(response.data)
      return response.data;
    } catch (error) {
      this.logger.error(`Error syncing invoices from Epicor: ${error.message}`, error.stack);
      throw error;
    }
  }

  async fetchAllInvoicesFromBaq(
    epicorTenantConfig: EpicorTenantConfig,
    odataParams?: { select?: string; filter?: string; top?: number; skip?: number; count?: boolean, expand?: string, orderBy?: string }
  ): Promise<EpicorResponse & { '@odata.count'?: number }> {
    try {
      this.logger.log(`Fetching invoices from Epicor BAQ for company: ${epicorTenantConfig.companyID} with OData params: ${JSON.stringify(odataParams)}`);

      let url = `${epicorTenantConfig.serverBaseAPI}/odata/${epicorTenantConfig.companyID}/Erp.BO.ARInvoiceSvc/ARInvoices`;

      const queryParams: string[] = [];
      if (odataParams?.filter && odataParams.filter.trim() !== '') {
        queryParams.push(`$filter=${odataParams.filter}`);
      }

      if (odataParams?.select && odataParams.select.trim() !== '') {
        queryParams.push(`$select=${odataParams.select}`);
      }

      if (odataParams?.top !== undefined) {
        queryParams.push(`$top=${odataParams.top}`);
      }

      if (odataParams?.skip !== undefined) {
        queryParams.push(`$skip=${odataParams.skip}`);
      }

      if (odataParams?.count) {
        queryParams.push(`$count=true`);
      }

      if (odataParams?.expand) {
        queryParams.push(`$expand=${odataParams.expand}`);
      }

      if (odataParams?.orderBy) {
        queryParams.push(`$orderby=${odataParams.orderBy}`);
      }

      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`;
      }


      console.log("url", url)
      const headers = {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${epicorTenantConfig.userAccount}:${epicorTenantConfig.password || ''}`).toString('base64')}`,
        'X-API-Key': epicorTenantConfig.apiKey,
      };

      this.logger.log(`Requesting Epicor BAQ URL: ${url},headers:${JSON.stringify(headers)}`);
      const response = await lastValueFrom(
        this.httpService.get<EpicorResponse & { '@odata.count'?: number }>(url, { headers })
      );

      this.logger.log(`Retrieved invoice items from Epicor BAQ. Count in response: ${response.data['@odata.count']}, Items in value: ${response.data.value?.length || 0}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Error fetching invoices from Epicor BAQ: ${error.message}`, error.stack);
      if (error.response) {
        this.logger.error(`Epicor BAQ Error Response Data: ${JSON.stringify(error.response.data)}`);
        this.logger.error(`Epicor BAQ Error Response Status: ${error.response.status}`);
        this.logger.error(`Epicor BAQ Error Response Headers: ${JSON.stringify(error.response.headers)}`);
      }
      throw error;
    }
  }

  /**
   * Get a single invoice by ID from Epicor
   * @param epicorTenantConfig Epicor tenant configuration
   * @param invoiceId Invoice ID
   * @returns Invoice data with details
   */
  async getInvoiceById(
    epicorTenantConfig: EpicorTenantConfig,
    invoiceId: number
  ): Promise<EpicorInvoiceHeader | null> {
    try {
      this.logger.log(`Fetching invoice ${invoiceId} from Epicor for company: ${epicorTenantConfig.companyID}`);

      const url = `${epicorTenantConfig.serverBaseAPI}/odata/${epicorTenantConfig.companyID}/Erp.BO.ARInvoiceSvc/ARInvoices('${epicorTenantConfig.companyID}',${invoiceId})?$expand=InvcDtls`;

      const headers = {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${epicorTenantConfig.userAccount}:${epicorTenantConfig.password || ''}`).toString('base64')}`,
        'X-API-Key': epicorTenantConfig.apiKey
      };

      this.logger.log(`Requesting Epicor invoice URL: ${url}`);
      const response = await lastValueFrom(
        this.httpService.get<EpicorInvoiceHeader>(url, { headers })
      );

      this.logger.log(`Retrieved invoice ${invoiceId} from Epicor successfully`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        this.logger.warn(`Invoice ${invoiceId} not found in Epicor`);
        return null;
      }
      this.logger.error(`Error fetching invoice ${invoiceId} from Epicor: ${error.message}`, error.stack);
      if (error.response) {
        this.logger.error(`Epicor Error Response Data: ${JSON.stringify(error.response.data)}`);
        this.logger.error(`Epicor Error Response Status: ${error.response.status}`);
      }
      throw error;
    }
  }

  /**
   * Update invoice status in Epicor
   * @param epicorTenantConfig Epicor tenant configuration
   * @param invoiceId Invoice ID
   * @param updateData Data to update
   * @returns Updated invoice data
   */
  async updateInvoiceStatus(
    epicorTenantConfig: EpicorTenantConfig,
    invoiceId: number,
    updateData: {
      ELIEInvoice?: boolean;
      ELIEInvStatus?: number;
      ELIEInvUpdatedBy?: string;
      ELIEInvException?: string;
      ELIEInvUpdatedOn?: string;
      EInvRefNum?: string;
      ELIEInvID?: string;
      RowMod: string;
    }
  ): Promise<any> {
    try {
      this.logger.log(`Updating invoice ${invoiceId} status in Epicor for company: ${epicorTenantConfig.companyID}`);

      const url = `${epicorTenantConfig.serverBaseAPI}/odata/${epicorTenantConfig.companyID}/Erp.BO.ARInvoiceSvc/ARInvoices('${epicorTenantConfig.companyID}',${invoiceId})`;

      const headers = {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${epicorTenantConfig.userAccount}:${epicorTenantConfig.password || ''}`).toString('base64')}`,
        'X-API-Key': epicorTenantConfig.apiKey
      };

      this.logger.log(`Updating Epicor invoice URL: ${url} with data: ${JSON.stringify(updateData)}`);
      const response = await lastValueFrom(
        this.httpService.patch(url, updateData, { headers })
      );

      this.logger.log(`Updated invoice ${invoiceId} status in Epicor successfully`);
      return response.data;
    } catch (error) {
      this.logger.error(`Error updating invoice ${invoiceId} status in Epicor: ${error.message}`, error.stack);
      if (error.response) {
        this.logger.error(`Epicor Update Error Response Data: ${JSON.stringify(error.response.data)}`);
        this.logger.error(`Epicor Update Error Response Status: ${error.response.status}`);
      }
      throw error;
    }
  }

  // async updateInvoiceFromEpicor(invoice: EpicorInvoice): Promise<EpicorInvoice> {
  //   try {
  //     const url = `${this.config.baseUrl}/BaqSvc/InvReport(${invoice.InvcHead_InvoiceNum})`;
  //   } catch (error) {
  //     this.logger.error(`Error updating invoice in Epicor: ${error.message}`, error.stack);
  //     throw error;
  //   }
  // }

  // async createInvoiceFromEpicor(invoice: EpicorInvoice): Promise<EpicorInvoice> {
  //   try {
  //     const url = `${this.config.baseUrl}/BaqSvc/InvReport(${invoice.InvcHead_InvoiceNum})`;
  //   } catch (error) {
  //     this.logger.error(`Error creating invoice in Epicor: ${error.message}`, error.stack);
  //     throw error;
  //   }
  // }

  /**
   * 获取需要清理ELIEInvoice字段的发票列表
   * @param epicorTenantConfig Epicor tenant configuration
   * @param filter 过滤条件，默认为 "ELIEInvUpdatedBy ne ''"
   * @returns 符合条件的发票列表
   */
  async getInvoicesForELIEFieldReset(
    epicorTenantConfig: EpicorTenantConfig,
    filter: string = "ELIEInvUpdatedBy ne ''"
  ): Promise<any[]> {
    try {
      this.logger.log(`Fetching invoices for ELIE field reset from Epicor for company: ${epicorTenantConfig.companyID}`);

      const url = `${epicorTenantConfig.serverBaseAPI}/odata/${epicorTenantConfig.companyID}/Erp.BO.ARInvoiceSvc/ARInvoices?$filter=${encodeURIComponent(filter)}&$select=InvoiceNum,ELIEInvoice,ELIEInvStatus,ELIEInvUpdatedBy,ELIEInvException,ELIEInvUpdatedOn,EInvRefNum,ELIEInvID`;

      const headers = {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${epicorTenantConfig.userAccount}:${epicorTenantConfig.password || ''}`).toString('base64')}`,
      };

      if (epicorTenantConfig.apiKey) {
        headers['X-API-Key'] = epicorTenantConfig.apiKey;
      }

      this.logger.log(`Requesting Epicor invoices for reset URL: ${url}`);
      const response = await lastValueFrom(
        this.httpService.get<{ value: any[] }>(url, { headers })
      );

      this.logger.log(`Retrieved ${response.data.value?.length || 0} invoices for ELIE field reset from Epicor`);
      return response.data.value || [];
    } catch (error) {
      this.logger.error(`Error fetching invoices for ELIE field reset from Epicor: ${error.message}`, error.stack);
      if (error.response) {
        this.logger.error(`Epicor Error Response Data: ${JSON.stringify(error.response.data)}`);
        this.logger.error(`Epicor Error Response Status: ${error.response.status}`);
      }
      throw error;
    }
  }

  /**
   * 重置单个发票的ELIEInvoice相关字段
   * @param epicorTenantConfig Epicor tenant configuration
   * @param invoiceId Invoice ID
   * @param resetData 重置数据
   * @returns 是否成功
   */
  async resetSingleInvoiceELIEFields(
    epicorTenantConfig: EpicorTenantConfig,
    invoiceId: number,
    resetData?: Partial<ELIEInvoiceResetData>
  ): Promise<boolean> {
    try {
      this.logger.log(`Resetting ELIE fields for invoice ${invoiceId} in Epicor for company: ${epicorTenantConfig.companyID}`);

      const defaultResetData: ELIEInvoiceResetData = {
        ELIEInvoice: false,
        ELIEInvStatus: 0,
        ELIEInvUpdatedBy: '',
        ELIEInvException: '',
        ELIEInvUpdatedOn: null,
        EInvRefNum: '',
        ELIEInvID: '',
        RowMod: 'U'
      };

      const updateData = { ...defaultResetData, ...resetData };

      const url = `${epicorTenantConfig.serverBaseAPI}/odata/${epicorTenantConfig.companyID}/Erp.BO.ARInvoiceSvc/ARInvoices('${epicorTenantConfig.companyID}',${invoiceId})`;

      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${epicorTenantConfig.userAccount}:${epicorTenantConfig.password || ''}`).toString('base64')}`,
      };

      if (epicorTenantConfig.apiKey) {
        headers['X-API-Key'] = epicorTenantConfig.apiKey;
      }

      this.logger.log(`Resetting ELIE fields for invoice URL: ${url} with data: ${JSON.stringify(updateData)}`);
      const response = await lastValueFrom(
        this.httpService.patch(url, updateData, { headers })
      );

      this.logger.log(`Successfully reset ELIE fields for invoice ${invoiceId} in Epicor`);
      return true;
    } catch (error) {
      this.logger.error(`Error resetting ELIE fields for invoice ${invoiceId} in Epicor: ${error.message}`, error.stack);
      if (error.response) {
        this.logger.error(`Epicor Reset Error Response Data: ${JSON.stringify(error.response.data)}`);
        this.logger.error(`Epicor Reset Error Response Status: ${error.response.status}`);
      }
      return false;
    }
  }

  /**
   * 批量重置ELIEInvoice相关字段
   * @param epicorTenantConfig Epicor tenant configuration
   * @param options 重置选项
   * @returns 重置结果
   */
  async batchResetELIEInvoiceFields(
    epicorTenantConfig: EpicorTenantConfig,
    options: ELIEInvoiceResetOptions = {}
  ): Promise<ELIEInvoiceResetResult> {
    const { batchSize = 100, filter = "ELIEInvUpdatedBy ne ''" } = options;

    try {
      this.logger.log(`Starting batch reset of ELIE invoice fields for company: ${epicorTenantConfig.companyID}`);

      // 获取需要重置的发票
      const invoices = await this.getInvoicesForELIEFieldReset(epicorTenantConfig, filter);

      if (invoices.length === 0) {
        this.logger.log('No invoices found for ELIE field reset');
        return {
          totalProcessed: 0,
          successCount: 0,
          failureCount: 0,
          errors: []
        };
      }

      this.logger.log(`Found ${invoices.length} invoices for ELIE field reset`);

      let successCount = 0;
      let failureCount = 0;
      const errors: Array<{ invoiceNum: number; error: string }> = [];

      // 分批处理
      for (let i = 0; i < invoices.length; i += batchSize) {
        const batch = invoices.slice(i, i + batchSize);

        this.logger.log(`Processing batch ${i / batchSize + 1}, ${batch.length} invoices`);

        // 并行处理每一批
        const resetPromises = batch.map(async (invoice) => {
          const success = await this.resetSingleInvoiceELIEFields(epicorTenantConfig, invoice.InvoiceNum);
          return { invoiceNum: invoice.InvoiceNum, success };
        });

        const results = await Promise.all(resetPromises);

        // 统计结果
        results.forEach(result => {
          if (result.success) {
            successCount++;
          } else {
            failureCount++;
            errors.push({
              invoiceNum: result.invoiceNum,
              error: 'Reset failed'
            });
          }
        });

        this.logger.log(`Batch ${i / batchSize + 1} completed, success: ${results.filter(r => r.success).length}, failed: ${results.filter(r => !r.success).length}`);

        // 添加延迟，避免过度请求
        if (i + batchSize < invoices.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const result: ELIEInvoiceResetResult = {
        totalProcessed: invoices.length,
        successCount,
        failureCount,
        errors
      };

      this.logger.log(`Batch reset completed! Total: ${invoices.length}, Success: ${successCount}, Failed: ${failureCount}`);
      return result;

    } catch (error) {
      this.logger.error(`Error during batch reset of ELIE invoice fields: ${error.message}`, error.stack);
      throw error;
    }
  }
}