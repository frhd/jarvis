/**
 * Format detection indicators for text content analysis
 */

/** Patterns that indicate Markdown formatting */
export const MARKDOWN_INDICATORS = ['```', '**', '##', '[]('] as const;

/** Patterns that indicate HTML formatting */
export const HTML_INDICATORS = ['<html>', '<p>', '<div>'] as const;
