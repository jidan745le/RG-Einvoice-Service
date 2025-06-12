import { Injectable, Logger } from '@nestjs/common';

export interface PendingInvoiceData {
    invoiceNum: string;
    epicorTenantCompany: string;
    customerName: string;
    displayBillAddr: string;
    createdOn: Date;
    lastCheckedAt: Date;
}

@Injectable()
export class AuthorizationCacheService {
    private readonly logger = new Logger(AuthorizationCacheService.name);

    // Cache to store authorization by orderNo for callback processing
    private readonly authorizationCache = new Map<string, { authorization: string; tenantId: string; timestamp: number }>();

    // Cache to store pending invoices (Posted=false)
    private readonly pendingInvoicesCache = new Map<string, PendingInvoiceData>();

    // Cache cleanup interval (24 hours)
    private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    // Pending invoices cleanup interval (7 days)
    private readonly PENDING_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    constructor() {
        // Clean up expired cache entries every hour
        setInterval(() => {
            this.cleanupExpiredCache();
            this.cleanupExpiredPendingInvoices();
        }, 60 * 60 * 1000); // 1 hour
    }

    /**
     * Clean up expired cache entries
     */
    private cleanupExpiredCache(): void {
        const now = Date.now();
        for (const [orderNo, entry] of this.authorizationCache.entries()) {
            if (now - entry.timestamp > this.CACHE_TTL) {
                this.authorizationCache.delete(orderNo);
                this.logger.log(`Cleaned up expired cache entry for orderNo: ${orderNo}`);
            }
        }
    }

    /**
     * Clean up expired pending invoices
     */
    private cleanupExpiredPendingInvoices(): void {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [key, pendingInvoice] of this.pendingInvoicesCache.entries()) {
            if (now - pendingInvoice.lastCheckedAt.getTime() > this.PENDING_CACHE_TTL) {
                this.pendingInvoicesCache.delete(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            this.logger.log(`Cleaned up ${cleanedCount} expired pending invoice cache entries`);
        }
    }

    /**
     * Store authorization for callback processing
     */
    storeAuthorizationForCallback(orderNo: string, authorization: string, tenantId: string): void {
        this.authorizationCache.set(orderNo, {
            authorization,
            tenantId,
            timestamp: Date.now()
        });
        this.logger.log(`Stored authorization for orderNo: ${orderNo}, tenantId: ${tenantId}`);

        // Debug: Log cache size after storing
        this.logger.log(`Authorization cache size after storing: ${this.authorizationCache.size}`);
    }

    /**
     * Retrieve authorization for callback processing
     */
    getAuthorizationForCallback(orderNo: string): { authorization: string; tenantId: string } | null {
        const entry = this.authorizationCache.get(orderNo);
        if (!entry) {
            this.logger.warn(`No authorization found in cache for orderNo: ${orderNo}`);
            return null;
        }

        // Check if entry is expired
        if (Date.now() - entry.timestamp > this.CACHE_TTL) {
            this.authorizationCache.delete(orderNo);
            this.logger.warn(`Authorization cache entry expired for orderNo: ${orderNo}`);
            return null;
        }

        this.logger.log(`Retrieved authorization for orderNo: ${orderNo}, tenantId: ${entry.tenantId}`);
        return {
            authorization: entry.authorization,
            tenantId: entry.tenantId
        };
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { totalEntries: number; oldestEntry: Date | null; newestEntry: Date | null } {
        const entries = Array.from(this.authorizationCache.values());

        if (entries.length === 0) {
            return {
                totalEntries: 0,
                oldestEntry: null,
                newestEntry: null
            };
        }

        const timestamps = entries.map(entry => entry.timestamp);
        const oldestTimestamp = Math.min(...timestamps);
        const newestTimestamp = Math.max(...timestamps);

        return {
            totalEntries: entries.length,
            oldestEntry: new Date(oldestTimestamp),
            newestEntry: new Date(newestTimestamp)
        };
    }

    /**
     * Clear cache
     */
    clearCache(): { clearedEntries: number } {
        const entriesCount = this.authorizationCache.size;
        this.authorizationCache.clear();
        this.logger.log(`Manually cleared ${entriesCount} authorization cache entries`);

        return { clearedEntries: entriesCount };
    }

    /**
     * Get the authorization cache (for debugging purposes)
     */
    getAuthorizationCache(): Map<string, { authorization: string; tenantId: string; timestamp: number }> {
        return this.authorizationCache;
    }

    /**
     * Clear authorization cache (alias for clearCache)
     */
    clearAuthorizationCache(): void {
        this.clearCache();
    }

    // ===============================
    // Pending Invoices Cache Methods
    // ===============================

    /**
     * Store pending invoice (Posted=false)
     */
    storePendingInvoice(invoiceNum: string, epicorTenantCompany: string, customerName: string, displayBillAddr: string, createdOn: Date): void {
        const key = `${epicorTenantCompany}:${invoiceNum}`;

        this.pendingInvoicesCache.set(key, {
            invoiceNum,
            epicorTenantCompany,
            customerName,
            displayBillAddr,
            createdOn,
            lastCheckedAt: new Date()
        });

        this.logger.log(`Stored pending invoice: ${invoiceNum} for tenant: ${epicorTenantCompany}`);
        this.logger.log(`Pending invoices cache size: ${this.pendingInvoicesCache.size}`);
    }

    /**
     * Update last checked time for a pending invoice
     */
    updatePendingInvoiceLastChecked(invoiceNum: string, epicorTenantCompany: string): void {
        const key = `${epicorTenantCompany}:${invoiceNum}`;
        const pendingInvoice = this.pendingInvoicesCache.get(key);

        if (pendingInvoice) {
            pendingInvoice.lastCheckedAt = new Date();
            this.pendingInvoicesCache.set(key, pendingInvoice);
            this.logger.debug(`Updated last checked time for pending invoice: ${invoiceNum}`);
        }
    }

    /**
     * Remove pending invoice from cache (when it becomes Posted=true)
     */
    removePendingInvoice(invoiceNum: string, epicorTenantCompany: string): boolean {
        const key = `${epicorTenantCompany}:${invoiceNum}`;
        const removed = this.pendingInvoicesCache.delete(key);

        if (removed) {
            this.logger.log(`Removed pending invoice from cache: ${invoiceNum} for tenant: ${epicorTenantCompany}`);
        }

        return removed;
    }

    /**
     * Get all pending invoices for a specific tenant
     */
    getPendingInvoicesForTenant(epicorTenantCompany: string): PendingInvoiceData[] {
        const result: PendingInvoiceData[] = [];

        for (const [key, pendingInvoice] of this.pendingInvoicesCache.entries()) {
            if (pendingInvoice.epicorTenantCompany === epicorTenantCompany) {
                result.push(pendingInvoice);
            }
        }

        return result;
    }

    /**
     * Get all pending invoices
     */
    getAllPendingInvoices(): PendingInvoiceData[] {
        return Array.from(this.pendingInvoicesCache.values());
    }

    /**
     * Check if an invoice is in pending cache
     */
    isPendingInvoice(invoiceNum: string, epicorTenantCompany: string): boolean {
        const key = `${epicorTenantCompany}:${invoiceNum}`;
        return this.pendingInvoicesCache.has(key);
    }

    /**
     * Get pending invoices cache statistics
     */
    getPendingInvoicesCacheStats(): {
        totalPendingInvoices: number;
        tenantDistribution: Record<string, number>;
        oldestPending: Date | null;
        newestPending: Date | null;
    } {
        const pendingInvoices = Array.from(this.pendingInvoicesCache.values());

        if (pendingInvoices.length === 0) {
            return {
                totalPendingInvoices: 0,
                tenantDistribution: {},
                oldestPending: null,
                newestPending: null
            };
        }

        // Calculate tenant distribution
        const tenantDistribution: Record<string, number> = {};
        let oldestDate = pendingInvoices[0].createdOn;
        let newestDate = pendingInvoices[0].createdOn;

        for (const pending of pendingInvoices) {
            tenantDistribution[pending.epicorTenantCompany] = (tenantDistribution[pending.epicorTenantCompany] || 0) + 1;

            if (pending.createdOn < oldestDate) {
                oldestDate = pending.createdOn;
            }
            if (pending.createdOn > newestDate) {
                newestDate = pending.createdOn;
            }
        }

        return {
            totalPendingInvoices: pendingInvoices.length,
            tenantDistribution,
            oldestPending: oldestDate,
            newestPending: newestDate
        };
    }

    /**
     * Clear all pending invoices cache
     */
    clearPendingInvoicesCache(): { clearedEntries: number } {
        const entriesCount = this.pendingInvoicesCache.size;
        this.pendingInvoicesCache.clear();
        this.logger.log(`Manually cleared ${entriesCount} pending invoice cache entries`);

        return { clearedEntries: entriesCount };
    }
} 