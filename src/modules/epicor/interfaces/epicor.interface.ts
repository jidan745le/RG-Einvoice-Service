export interface EpicorConfig {
  baseUrl: string;
  apiKey: string;
  username: string;
  password: string;
}

export interface EpicorInvoice {
  InvcHead_InvoiceNum: number;
  InvcHead_Description: string;
  Customer_Name: string;
  Customer_ResaleID: string;
  InvcHead_InvoiceComment: string;
  InvcHead_CNTaxInvoiceType?: number;
  InvcHead_ELIEInvID?: string;
  InvcHead_ELIEInvStatus?: number;
  InvcHead_ELIEInvUpdatedBy?: string;
  InvcHead_ELIEInvUpdatedOn?: string;
  InvcHead_Posted: boolean;
  OrderHed_OrderNum?: number;
  OrderHed_OrderDate?: string;
  OrderHed_PONum?: string;
  InvcDtl_InvoiceNum: number;
  InvcDtl_InvoiceLine?: number;
  InvcDtl_LineDesc?: string;
  InvcDtl_CommodityCode?: string;
  UOMClass_Description?: string;
  InvcDtl_SalesUM?: string;
  InvcDtl_SellingShipQty?: string;
  InvcDtl_DocUnitPrice?: string;
  InvcDtl_DocExtPrice?: string;
  InvcTax_InvoiceLine?: number;
  InvcTax_TaxCode?: string;
  InvcTax_RateCode?: string;
  InvcTax_Percent?: string;
  RowIdent: string;
  SysRowID?: string;
}

// New interface for the updated Epicor API response structure
export interface EpicorInvoiceDetail {
  Company: string;
  InvoiceNum: number;
  InvoiceLine: number;
  LineType: string;
  LineDesc: string;
  IUM: string;
  UnitPrice: string;
  DocUnitPrice: string;
  ExtPrice: string;
  DocExtPrice: string;
  OurShipQty: string;
  SellingShipQty: string;
  SalesUM: string;
  CommodityCode: string;
  TaxPercent?: string;
  [key: string]: any; // For additional properties
}

export interface EpicorInvoiceHeader {
  Company: string;
  InvoiceNum: number;
  InvoiceType: string;
  OrderNum: number;
  CustNum: number;
  PONum: string;
  InvoiceDate: string;
  DueDate: string;
  InvoiceComment: string;
  InvoiceAmt: string;
  DocInvoiceAmt: string;
  CurrencyCode: string;
  CustomerName: string;
  CNTaxInvoiceType?: number;
  ELIEInvID?: string;
  ELIEInvStatus?: number;
  ELIEInvUpdatedBy?: string;
  ELIEInvUpdatedOn?: string;
  Description?: string;
  InvcDtls: EpicorInvoiceDetail[];
  [key: string]: any; // For additional properties
}

export interface EpicorResponse {
  'odata.metadata': string;
  value: EpicorInvoice[];
}

export interface EpicorNewResponse {
  'odata.metadata': string;
  value: EpicorInvoiceHeader[];
} 