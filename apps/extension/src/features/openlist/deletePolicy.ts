/** Only retention and cleanup after successful transfer are exposed by the extension. */
export type OpenListDeletePolicy = 'delete_never' | 'delete_on_upload_succeed';

export function isOpenListDeletePolicy(value: unknown): value is OpenListDeletePolicy | undefined {
  return value === undefined || value === 'delete_never' || value === 'delete_on_upload_succeed';
}
