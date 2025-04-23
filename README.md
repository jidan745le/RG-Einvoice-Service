# E-Invoice App

A NestJS application for managing electronic invoices in China, integrating with Epicor ERP and Baiwang e-invoicing service.

## Description

This application serves as a bridge between Epicor ERP and the Baiwang e-invoicing service, providing the following features:

- Sync invoices from Epicor ERP
- Submit invoices to Baiwang for official e-invoicing
- Handle callbacks from Baiwang with invoice results
- Query and manage invoice data with pagination and filtering

## Installation

```bash
# Install dependencies
$ npm install
```

## Configuration

Create a `.env` file in the root directory with the following content:

```
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=root
DB_DATABASE=einvoice
DB_SYNCHRONIZE=true
DB_LOGGING=false

# Baiwang API Configuration
BAIWANG_API_NAME=baiwang.s.outputinvoice.invoice
BAIWANG_APP_KEY=your_app_key
BAIWANG_APP_SECRET=your_app_secret
BAIWANG_TOKEN=your_token
BAIWANG_BASE_URL=https://sandbox-openapi.baiwang.com/router/rest
BAIWANG_VERSION=6.0

# Epicor API Configuration
EPICOR_BASE_URL=https://your-epicor-instance/api/v1
EPICOR_API_KEY=your_api_key
EPICOR_USERNAME=your_username
EPICOR_PASSWORD=your_password

# Server Configuration
PORT=3000
NODE_ENV=development
```

## Running the app

```bash
# Development mode
$ npm run start:dev

# Production mode
$ npm run start:prod
```

## API Endpoints

### Invoices

- `GET /api/invoice` - Get all invoices with pagination and filtering
- `GET /api/invoice/:id` - Get invoice by ID
- `POST /api/invoice` - Create a new invoice
- `PATCH /api/invoice/:id` - Update an invoice
- `POST /api/invoice/:id/submit` - Submit an invoice to Baiwang
- `POST /api/invoice/callback` - Handle callback from Baiwang
- `POST /api/invoice/sync` - Sync invoices from Epicor

## Database Schema

### Invoice Table

The invoice table stores the main invoice information:

- `id` - Primary key
- `erpInvoiceId` - Epicor invoice ID
- `postDate` - Invoice post date
- `customerName` - Customer name
- `invoiceAmount` - Invoice amount
- `status` - Invoice status (PENDING, SUBMITTED, COMPLETED, ERROR)
- `eInvoiceId` - E-invoice ID from Baiwang
- `eInvoicePdf` - URL to the e-invoice PDF
- `submittedBy` - User who submitted the invoice

### Invoice Detail Table

The invoice detail table stores the line items for each invoice:

- `id` - Primary key
- `invoiceId` - Foreign key to invoice table
- `erpInvoiceId` - Epicor invoice ID
- `lineDescription` - Product description
- `sellingShipQty` - Quantity
- `docUnitPrice` - Unit price
- `docExtPrice` - Extended price
- `taxPercent` - Tax percentage

## License

This project is licensed under the MIT License
