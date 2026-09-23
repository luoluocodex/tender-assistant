declare module 'word-extractor' {
  export default class WordExtractor {
    extract(input: Buffer): Promise<{ getBody(): string; getHeaders(): string; getFootnotes(): string; getEndnotes(): string }>;
  }
}
