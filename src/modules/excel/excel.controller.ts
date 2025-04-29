import { Controller, Post, Body, Res } from '@nestjs/common';
import { ExcelService } from './excel.service';
import { Response } from 'express';
import * as fs from 'fs';

@Controller('excel')
export class ExcelController {
    constructor(private readonly excelService: ExcelService) { }

    @Post('export')
    async exportInvoices(@Body() body: { epicorIds: string[] }, @Res() res: Response) {
        try {
            const filePath = await this.excelService.exportInvoices(body.epicorIds);

            // Set response headers
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=invoice_export.xlsx`);

            // Stream the file
            const fileStream = fs.createReadStream(filePath);
            fileStream.pipe(res);

            // Clean up the file after sending
            fileStream.on('end', () => {
                fs.unlinkSync(filePath);
            });
        } catch (error) {
            res.status(500).json({
                message: 'Error exporting invoices',
                error: error.message
            });
        }
    }
} 