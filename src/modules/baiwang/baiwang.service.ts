import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import * as CryptoJS from 'crypto-js';
import { lastValueFrom } from 'rxjs';
import { BaiwangConfig, BaiwangInvoiceRequest, BaiwangResponse, BaiwangRedInvoiceRequest, BaiwangRedInvoiceResponse } from './interfaces/baiwang.interface';

@Injectable()
export class BaiwangService {
  private readonly logger = new Logger(BaiwangService.name);
  private readonly config: BaiwangConfig;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.config = {
      apiName: this.configService.get<string>('BAIWANG_API_NAME', 'baiwang.s.outputinvoice.invoice'),
      appKey: this.configService.get<string>('BAIWANG_APP_KEY', ''),
      appSecret: this.configService.get<string>('BAIWANG_APP_SECRET', ''),
      token: this.configService.get<string>('BAIWANG_TOKEN', ''),
      baseUrl: this.configService.get<string>('BAIWANG_BASE_URL', 'https://sandbox-openapi.baiwang.com/router/rest'),
      version: this.configService.get<string>('BAIWANG_VERSION', '6.0'),
    };
  }

  /**
   * Submit invoice to Baiwang service
   * @param invoiceData Invoice data to be submitted
   * @returns Response from Baiwang API
   */
  async submitInvoice(invoiceData: BaiwangInvoiceRequest): Promise<BaiwangResponse> {
    try {
      this.logger.log(`Submitting invoice to Baiwang: ${JSON.stringify(invoiceData)}`);

      // Create protocol request parameters
      const textParams = {
        method: this.config.apiName,
        version: this.config.version,
        appKey: this.config.appKey,
        format: 'json',
        timestamp: String(Date.now()),
        requestId: uuidv4(),
        token: this.config.token,
        type: 'sync',
      };

      // Generate request body
      const requestBody = JSON.stringify(invoiceData);
      this.logger.log(`Request body: ${requestBody}`);
      // Generate signature
      const sign = this.generateSignature(textParams, requestBody);

      // Build URL with parameters
      const url = this.buildUrl(textParams, sign);

      // Send HTTP request
      const response = await lastValueFrom(
        this.httpService.post(url, requestBody, {
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
      this.logger.log(`Baiwang API response: ${JSON.stringify(response.data)}`);

      if (response.data.success !== true) {
        throw new Error(`${response.data.errorResponse.code} - ${response.data.errorResponse.message} - ${response.data.errorResponse.subMessage}`);
      }
      return response.data;
    } catch (error) {
      this.logger.error(`Error submitting invoice to Baiwang: ${error.message}`, error.stack);
      // 抛出一个 HttpException 而不是原始错误
      throw new HttpException({
        status: HttpStatus.BAD_REQUEST,
        error: `发票提交失败: ${error.message}`,
      }, HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Generate signature for Baiwang API
   * @param params API parameters
   * @param body Request body
   * @returns MD5 signature
   */
  private generateSignature(params: Record<string, string>, body: string): string {
    // Sort parameters alphabetically
    const keys = Object.keys(params).sort();

    // Build signature string
    let signStr = this.config.appSecret;
    for (const key of keys) {
      const value = params[key];
      if (key && value) {
        signStr += key + value;
      }
    }

    // Add request body
    signStr += body;

    // Add app secret again as suffix
    signStr += this.config.appSecret;

    // Generate MD5 hash
    return CryptoJS.MD5(signStr).toString().toUpperCase();
  }

  /**
   * Build complete URL with parameters
   * @param params API parameters
   * @param sign Signature
   * @returns Complete URL
   */
  private buildUrl(params: Record<string, string>, sign: string): string {
    const url = new URL(this.config.baseUrl);

    // Add parameters to URL
    url.searchParams.append('method', params.method);
    url.searchParams.append('version', params.version);
    url.searchParams.append('appKey', params.appKey);
    url.searchParams.append('format', params.format);
    url.searchParams.append('timestamp', params.timestamp);
    url.searchParams.append('token', params.token);
    url.searchParams.append('type', params.type);
    url.searchParams.append('requestId', params.requestId);
    url.searchParams.append('sign', sign);

    return url.toString();
  }

  /**
   * Process callback data from Baiwang
   * @param callbackData Callback data received from Baiwang
   * @returns Processed callback data
   */
  async processCallback(callbackData: any): Promise<any> {
    this.logger.log(`Received callback from Baiwang: ${JSON.stringify(callbackData)}`);

    // Process and validate callback data
    // This method just logs the data for now; it will be enhanced to update the database later

    return {
      success: true,
      data: callbackData,
    };
  }

  /**
   * Submit red invoice request to Baiwang
   * @param redInvoiceData Red invoice request data
   * @returns Response from Baiwang API
   */
  async submitRedInvoice(redInvoiceData: BaiwangRedInvoiceRequest): Promise<BaiwangRedInvoiceResponse> {
    try {
      this.logger.log(`Submitting red invoice to Baiwang: ${JSON.stringify(redInvoiceData)}`);

      // Create protocol request parameters
      const textParams = {
        method: 'baiwang.s.outputinvoice.fastRed',
        version: this.config.version,
        appKey: this.config.appKey,
        format: 'json',
        timestamp: String(Date.now()),
        requestId: uuidv4(),
        token: this.config.token,
        type: 'sync',
      };

      // Generate request body
      const requestBody = JSON.stringify(redInvoiceData);
      this.logger.log(`Request body: ${requestBody}`);

      // Generate signature
      const sign = this.generateSignature(textParams, requestBody);

      // Build URL with parameters
      const url = this.buildUrl(textParams, sign);

      // Send HTTP request
      const response = await lastValueFrom(
        this.httpService.post(url, requestBody, {
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
      this.logger.log(`Baiwang API response: ${JSON.stringify(response.data)}`);

      if (response.data.success !== true) {
        throw new Error(`${response.data.errorResponse.code} - ${response.data.errorResponse.message} - ${response.data.errorResponse.subMessage}`);
      }
      return response.data;
    } catch (error) {
      this.logger.error(`Error submitting red invoice to Baiwang: ${error.message}`, error.stack);
      throw new HttpException({
        status: HttpStatus.BAD_REQUEST,
        error: `红字发票提交失败: ${error.message}`,
      }, HttpStatus.BAD_REQUEST);
    }
  }
}
