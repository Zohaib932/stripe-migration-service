declare module "xlsx-populate" {
    export interface Cell {
        value(): unknown;
        value(nextValue: unknown): Cell;
        rowNumber(): number;
        columnNumber(): number;
    }

    export interface Range {
        value(): unknown[][];
        endCell(): Cell;
    }

    export interface Sheet {
        name(): string;
        name(nextName: string): Sheet;
        usedRange(): Range | undefined;
        cell(rowNumber: number, columnNumber: number): Cell;
        cell(address: string): Cell;
    }

    export interface Workbook {
        sheet(name: string): Sheet | undefined;
        sheet(index: number): Sheet;
        sheets(): Sheet[];
        toFileAsync(filePath: string): Promise<void>;
    }

    const XlsxPopulate: {
        fromFileAsync(filePath: string): Promise<Workbook>;
        fromBlankAsync(): Promise<Workbook>;
    };

    export default XlsxPopulate;
}