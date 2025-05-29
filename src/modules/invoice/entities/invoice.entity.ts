import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany, Unique } from 'typeorm';
import { InvoiceDetail } from './invoice-detail.entity';

@Entity('invoices')
@Unique(['erpInvoiceId', 'epicorTenantCompany'])
export class Invoice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'erp_invoice_id', nullable: false })
  erpInvoiceId: number;

  @Column({ name: 'post_date', type: 'date', nullable: true })
  postDate: Date | null;

  @Column({ name: 'erp_invoice_description', nullable: true })
  erpInvoiceDescription: string;

  @Column({ name: 'customer_name', nullable: true })
  customerName: string;

  @Column({ name: 'customer_resale_id', nullable: true })
  customerResaleId: string;

  @Column({ name: 'invoice_comment', nullable: true })
  invoiceComment: string;

  @Column({ name: 'fapiao_type', nullable: true })
  fapiaoType: string;

  @Column({ name: 'invoice_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  invoiceAmount: number;

  @Column({ name: 'status', default: 'PENDING' })
  status: string;

  @Column({ name: 'order_number', nullable: true })
  orderNumber: string;

  @Column({ name: 'digit_invoice_no', nullable: true })
  digitInvoiceNo: string;

  @Column({ name: 'e_invoice_id', nullable: true, type: 'varchar' })
  eInvoiceId: string | null;

  @Column({ name: 'e_invoice_pdf', nullable: true, type: 'varchar' })
  eInvoicePdf: string;

  @Column({ name: 'serial_no', nullable: true, type: 'varchar' })
  serialNo: string | null;

  @Column({ name: 'e_invoice_date', type: 'date', nullable: true })
  eInvoiceDate: Date | null;

  @Column({ name: 'submitted_by', nullable: true, type: 'varchar' })
  submittedBy: string | null;

  @Column({ name: 'order_date', type: 'date', nullable: true })
  orderDate: Date | null;

  @Column({ name: 'po_number', nullable: true })
  poNumber: string;

  @Column({ name: 'comment', nullable: true, type: 'varchar' })
  comment: string | null;

  @Column({ nullable: true })
  redInfoNo: string;

  @Column({ nullable: true })
  redInfoSerialNo: string;

  @Column({ nullable: true })
  redInfoStatus: string;

  @Column({ nullable: true })
  redInfoMessage: string;

  @Column({ nullable: true })
  redInfoType: string;

  @Column({ name: 'has_pdf', type: 'boolean', default: false })
  hasPdf: boolean;

  @Column({ name: 'epicor_tenant_company', nullable: true, type: 'varchar' })
  epicorTenantCompany: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => InvoiceDetail, invoiceDetail => invoiceDetail.invoice)
  invoiceDetails: InvoiceDetail[];

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
} 