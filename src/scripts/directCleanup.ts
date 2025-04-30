import { createConnection, getConnection } from 'typeorm';
import { Invoice } from '../modules/invoice/entities/invoice.entity';
import { InvoiceDetail } from '../modules/invoice/entities/invoice-detail.entity';
import * as fs from 'fs';
import * as path from 'path';

const isDev = process.env.NODE_ENV === 'development';
const logFile = path.join(process.cwd(), 'logs', 'database-cleanup.log');

// 确保日志目录存在
const logDir = path.dirname(logFile);
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

function logOperation(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logMessage);
    console.log(message);
}

/**
 * 安全删除所有数据
 * @param batchSize 每批处理的数量
 * @returns 删除的记录数
 */
async function cleanupAllData(batchSize: number = 1000): Promise<{ invoices: number; details: number }> {
    logOperation('Starting cleanup of all data');

    let totalInvoices = 0;
    let totalDetails = 0;

    try {
        // 创建TypeORM连接
        const connection = await createConnection({
            type: 'mysql',
            host: process.env.DB_HOST || 'localhost',
            port: Number(process.env.DB_PORT) || 3306,
            username: process.env.DB_USERNAME || 'root',
            password: process.env.DB_PASSWORD || '123456',
            database: process.env.DB_DATABASE || 'einvoice',
            entities: [Invoice, InvoiceDetail],
            synchronize: false
        });

        try {
            // 使用事务确保数据一致性
            await connection.transaction(async (manager) => {
                // 1. 先查询所有发票ID
                const invoiceIds = await manager
                    .createQueryBuilder()
                    .select('id')
                    .from(Invoice, 'invoice')
                    .getRawMany();

                const ids = invoiceIds.map(item => item.id);

                if (ids.length === 0) {
                    logOperation('No data found to delete');
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
                    logOperation(`Deleted ${detailsAffected} invoice details in batch ${i / batchSize + 1}`);
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
                    logOperation(`Deleted ${invoicesAffected} invoices in batch ${i / batchSize + 1}`);
                }
            });
        } finally {
            // 关闭连接
            await connection.close();
        }

        logOperation(`Cleanup completed. Deleted ${totalInvoices} invoices and ${totalDetails} invoice details`);
        return { invoices: totalInvoices, details: totalDetails };
    } catch (error: any) {
        logOperation(`Error during cleanup: ${error.message || String(error)}`);
        throw error;
    }
}

async function bootstrap() {
    try {
        // 解析命令行参数
        const args = process.argv.slice(2);
        const command = args[0];

        if (!command) {
            console.log('已默认执行删除所有数据的操作');
        }

        const result = await cleanupAllData();
        console.log(`删除完成: 删除了 ${result.invoices} 张发票和 ${result.details} 条发票明细`);
    } catch (error: any) {
        console.error('删除过程中出错:', error.message || String(error));
        process.exit(1);
    }
}

bootstrap(); 