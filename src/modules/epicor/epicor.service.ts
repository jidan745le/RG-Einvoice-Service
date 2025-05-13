import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { EpicorConfig, EpicorResponse, EpicorInvoice } from './interfaces/epicor.interface';

export interface EpicorTenantConfig {
  serverBaseAPI: string;
  companyID: string;
  userAccount: string;
  password?: string; // Password might be optional if other auth methods are used, but for Basic it's needed
  // apiKey?: string; // Consider if API key is also per-tenant
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
    odataParams?: { filter?: string; top?: number; skip?: number; count?: boolean }
  ): Promise<EpicorResponse & { '@odata.count'?: number }> {
    try {
      this.logger.log(`Fetching invoices from Epicor BAQ for company: ${epicorTenantConfig.companyID} with OData params: ${JSON.stringify(odataParams)}`);

      let url = `${epicorTenantConfig.serverBaseAPI}/BaqSvc/InvReport(${epicorTenantConfig.companyID})/`;

      const queryParams: string[] = [];
      if (odataParams?.filter && odataParams.filter.trim() !== '') {
        queryParams.push(`$filter=${odataParams.filter}`);
      }
      // if (odataParams?.top !== undefined) {
      //   queryParams.push(`$top=${odataParams.top}`);
      // }
      // if (odataParams?.skip !== undefined) {
      //   queryParams.push(`$skip=${odataParams.skip}`);
      // }
      // if (odataParams?.count) {
      //   queryParams.push(`$count=true`);
      // }

      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`;
      }

      const headers = {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${epicorTenantConfig.userAccount}:${epicorTenantConfig.password || ''}`).toString('base64')}`,
      };

      this.logger.log(`Requesting Epicor BAQ URL: ${url}`);
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
}