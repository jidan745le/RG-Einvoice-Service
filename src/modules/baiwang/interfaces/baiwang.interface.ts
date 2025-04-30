export interface BaiwangConfig {
  apiName: string;
  appKey: string;
  appSecret: string;
  token: string;
  baseUrl: string;
  version: string;
}

export interface InvoiceDetailItem {
  deductibleAmount?: string;
  goodsTaxRate: string;
  invoiceLineNature?: string;
  detailCustomField3?: string;
  detailCustomField2?: string;
  detailCustomField1?: string;
  goodsTotalPriceTax?: string;
  goodsTotalPrice: string;
  detailCustomField5?: string;
  detailCustomField4?: string;
  goodsPersonalCode?: string;
  goodsSpecification?: string;
  goodsPrice: string;
  freeTaxMark?: string;
  goodsQuantity: string;
  goodsTotalTax?: string;
  goodsUnit?: string;
  goodsCode?: string;
  preferentialMark?: string;
  goodsName: string;
  vatSpecialManagement?: string;
}

export interface BaiwangInvoiceRequest {
  buyerTelephone?: string;
  priceTaxMark: string;
  customField1?: string;
  customField2?: string;
  customField3?: string;
  invoiceDetailList: InvoiceDetailItem[];
  sellerName?: string;
  paperInvoiceType?: string;
  redInvoiceLabel?: string;
  sellerAddress?: string;
  checker?: string;
  redInfoNo?: string;
  payee?: string;
  buyerAddress?: string;
  buyerBankName?: string;
  invoiceTerminalCode?: string;
  invoiceType: string;
  taxNo: string;
  pushEmail?: string;
  orderDateTime: string;
  pushPhone?: string;
  orderNo: string;
  callBackUrl?: string;
  buyerTaxNo?: string;
  sellerPhone?: string;
  drawer?: string;
  invoiceSpecialMark?: string;
  buyerName: string;
  originalInvoiceNo?: string;
  invoiceListMark?: string;
  sellerBankNumber?: string;
  naturalMark?: string;
  buyerBankNumber?: string;
  originalDigitInvoiceNo?: string;
  invoiceTypeCode: string;
  sellerBankName?: string;
  remarks?: string;
  originalInvoiceCode?: string;
}

export interface BaiwangResponse {
  code: string;
  message: string;
  data?: any;
}

export interface BaiwangCallbackData {
  orderNo: string;
  digitInvoiceNo: string;
  invoiceCode: string;
  invoiceNo: string;
  invoiceDate: string;
  pdfUrl: string;
  totalAmount: string;
  taxAmount: string;
  invoiceType: string;
  checkCode: string;
  buyerName: string;
  buyerTaxNo: string;
  sellerName: string;
  sellerTaxNo: string;
  status: string;
  statusDesc: string;
  callBackResult: string;
  callBackMsg?: string;
}

export interface RedInvoiceDetailItem {
  originalInvoiceDetailNo?: string;
  goodsName: string;
  goodsCode: string;
  goodsQuantity?: string;
  goodsPrice?: string;
  goodsTaxRate: string;
  goodsTotalPrice: string;
  goodsTotalTax: string;
  goodsSpecification?: string;
  goodsUnit?: string;
  freeTaxMark?: string;
  preferentialMark?: string;
  vatSpecialManagement?: string;
}

export interface BaiwangRedInvoiceRequest {
  taxNo: string;
  orderNo: string;
  originalSerialNo?: string;
  originalOrderNo?: string;
  originalInvoiceCode?: string;
  originalInvoiceNo?: string;
  originalDigitInvoiceNo?: string;
  invoiceTypeCode?: string;
  fastIssueRedType?: string;
  redInvoiceLabel?: string;
  entryIdentity?: string;
  applyType?: string;
  pushEmail?: string;
  pushPhone?: string;
  drawerId?: string;
  orgId?: string;
  callBackUrl?: string;
  details?: RedInvoiceDetailItem[];
}

export interface BaiwangRedInvoiceResponse {
  success: boolean;
  method: string;
  requestId: string;
  response?: {
    redInfoSerialNo?: string;
    orderNo?: string;
    serialNo?: string;
    redConfirmSerialNo?: string;
  };
  errorResponse?: {
    code: number;
    message: string;
    subCode?: string;
    subMessage?: string;
  };
} 