/**
 * TYMCZASOWA ZAŚLEPKA — zastępowana w całości przez `npm run gen` po pierwszej migracji.
 * Do tego czasu pozwala aplikacji się kompilować przy pustym schemacie.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends never = never> = T;
export type TablesInsert<T extends never = never> = T;
export type TablesUpdate<T extends never = never> = T;
