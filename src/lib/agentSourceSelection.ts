export function selectSourceTables(tables: string[], included?: string[], excluded?: string[]): string[] {
  return tables.filter(table => {
    const source = table.replace(/_(residential|commercial)_listings$/, '');
    return (!included?.length || included.includes(source)) && !excluded?.includes(source);
  });
}
