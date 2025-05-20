import {
    Controller,
    Get,
    HttpException,
    HttpStatus,
    MaxFileSizeValidator,
    Param,
    ParseFilePipeBuilder,
    Post,
    Req,
    Res,
    StreamableFile,
    UploadedFile,
    UseInterceptors,
    Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Response, Request } from 'express';
import { lastValueFrom } from 'rxjs';
import * as FormData from 'form-data';

interface MulterFile {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    destination: string;
    filename: string;
    path: string;
    buffer: Buffer;
}

interface RequestWithUser extends Request {
    user?: {
        id?: string;
        tenantId?: string;
        tenant?: {
            id?: string;
        };
        [key: string]: any;
    };
}

@Controller('files')
export class FileController {
    private readonly logger = new Logger(FileController.name);

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) { }

    @Post('upload')
    @UseInterceptors(FileInterceptor('file'))
    async uploadFile(
        @UploadedFile(
            new ParseFilePipeBuilder()
                .addValidator(new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 })) // 5MB max size
                .build({
                    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
                }),
        )
        file: MulterFile,
        @Req() request: RequestWithUser,
    ) {
        try {
            const customerPortalUrl = this.configService.get<string>(
                'CUSTOMER_PORTAL_URL',
                'http://localhost:3000'
            );

            const authorization = request.headers.authorization;
            if (!authorization) {
                throw new HttpException('Authorization header is required', HttpStatus.UNAUTHORIZED);
            }

            // Create form data with the file
            const formData = new FormData();
            formData.append('file', file.buffer, {
                filename: file.originalname,
                contentType: file.mimetype,
            });

            // Proxy the upload to customer-hub
            const response = await lastValueFrom(
                this.httpService.post(
                    `${customerPortalUrl}/files/upload`,
                    formData,
                    {
                        headers: {
                            ...formData.getHeaders(),
                            Authorization: authorization,
                        },
                    }
                )
            );

            return response.data;
        } catch (error) {
            this.logger.error(`Failed to upload file: ${error.message}`, error.stack);

            if (error.response) {
                throw new HttpException(
                    error.response.data || 'Failed to upload file',
                    error.response.status || HttpStatus.INTERNAL_SERVER_ERROR,
                );
            }

            throw new HttpException(
                error.message || 'Failed to upload file',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Get(':filename')
    async getFile(
        @Param('filename') filename: string,
        @Res() response: Response,
        @Req() request: RequestWithUser,
    ) {
        try {
            const customerPortalUrl = this.configService.get<string>(
                'CUSTOMER_PORTAL_URL',
                'http://localhost:3000'
            );

            // Directly pipe the file from customer-hub to the response
            const fileResponse = await lastValueFrom(
                this.httpService.get(
                    `${customerPortalUrl}/files/${filename}`,
                    {
                        headers: {
                            Authorization: request.headers.authorization,
                        },
                        responseType: 'stream',
                    }
                )
            );

            // Forward content-type and other headers from the customer-hub response
            const headers = fileResponse.headers;
            Object.keys(headers).forEach(header => {
                // Skip certain headers that can cause issues
                if (!['transfer-encoding', 'connection'].includes(header.toLowerCase())) {
                    response.setHeader(header, headers[header]);
                }
            });

            // Pipe the file stream to our response
            fileResponse.data.pipe(response);
        } catch (error) {
            this.logger.error(`Failed to retrieve file ${filename}: ${error.message}`, error.stack);

            if (error.response) {
                response.status(error.response.status || HttpStatus.INTERNAL_SERVER_ERROR);
                response.send({
                    statusCode: error.response.status,
                    message: error.response.data?.message || 'Failed to retrieve file',
                });
            } else {
                response.status(HttpStatus.INTERNAL_SERVER_ERROR);
                response.send({
                    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                    message: error.message || 'Failed to retrieve file',
                });
            }
        }
    }
} 