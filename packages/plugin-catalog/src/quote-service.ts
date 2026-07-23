export {
  createQuote,
  deleteQuote,
  getQuoteByNumber,
  getRandomQuote,
  listQuotes,
  updateQuote,
} from '@herta/plugin-quote/service';
export { QuoteValidationError } from '@herta/plugin-quote/config';
export type {
  CreateQuoteInput,
  DeleteQuoteInput,
  ListQuotesInput,
  ListQuotesResult,
  QuoteOperationSource,
  QuotePrismaClient,
  QuoteRecord,
  UpdateQuoteInput,
} from '@herta/plugin-quote/service';
export type { QuoteConfig } from '@herta/plugin-quote/config';
