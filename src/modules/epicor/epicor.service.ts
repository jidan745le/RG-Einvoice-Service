import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { EpicorConfig, EpicorResponse } from './interfaces/epicor.interface';

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
      const url = `${this.config.baseUrl}/BaqSvc/InvReport(SIMALFA)`;
      
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
}
