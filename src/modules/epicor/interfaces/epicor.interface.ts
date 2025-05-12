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

export interface EpicorResponse {
  'odata.metadata': string;
  value: EpicorInvoice[];
} 