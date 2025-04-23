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
  InvcDtl_InvoiceNum: number;
  InvcDtl_LineDesc: string;
  InvcDtl_CommodityCode: string;
  UOMClass_Description: string;
  InvcDtl_SalesUM: string;
  InvcDtl_SellingShipQty: string;
  InvcDtl_DocUnitPrice: string;
  InvcDtl_DocExtPrice: string;
  InvcTax_Percent: string;
  InvcHead_Posted: boolean;
  OrderHed_OrderNum: number;
  OrderHed_OrderDate: string;
  OrderHed_PONum: string;
  RowIdent: string;
}

export interface EpicorResponse {
  'odata.metadata': string;
  value: EpicorInvoice[];
} 