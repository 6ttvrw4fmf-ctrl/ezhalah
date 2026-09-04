// «الشروط والخصوصية» — the OWNER'S text, paragraph by paragraph, in Arabic. Nothing here is drafted
// by engineering: the repo had no Terms of Use and no Privacy Policy on 2026-09-03, and the owner's
// instruction was "do NOT invent, rewrite, shorten, or replace any legal text". Until both documents
// are filled in, hasLegalDocs() is false and every door to the reader stays shut: the account-menu
// row is not rendered and the sign-in popup's «سياسة الخصوصية» is plain text, not a link.
export const LEGAL_DOCS: { terms: string[]; privacy: string[] } = {
  terms: [],
  privacy: [],
};

export const hasLegalDocs = (): boolean => LEGAL_DOCS.terms.length > 0 && LEGAL_DOCS.privacy.length > 0;
