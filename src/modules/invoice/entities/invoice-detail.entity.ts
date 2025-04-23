import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Invoice } from './invoice.entity';

@Entity('invoice_details')
export class InvoiceDetail {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'invoice_id' })
  invoiceId: number;

  @ManyToOne(() => Invoice, invoice => invoice.id, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ name: 'erp_invoice_id', nullable: false })
  erpInvoiceId: number;

  @Column({ name: 'line_description', nullable: true })
  lineDescription: string;

  @Column({ name: 'commodity_code', nullable: true })
  commodityCode: string;

  @Column({ name: 'uom_description', nullable: true })
  uomDescription: string;

  @Column({ name: 'sales_um', nullable: true })
  salesUm: string;

  @Column({ name: 'selling_ship_qty', type: 'decimal', precision: 13, scale: 8, nullable: true })
  sellingShipQty: number;

  @Column({ name: 'doc_unit_price', type: 'decimal', precision: 10, scale: 5, nullable: true })
  docUnitPrice: number;

  @Column({ name: 'doc_ext_price', type: 'decimal', precision: 10, scale: 3, nullable: true })
  docExtPrice: number;

  @Column({ name: 'tax_percent', type: 'decimal', precision: 10, scale: 5, nullable: true })
  taxPercent: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
} 