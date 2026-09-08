type PageAttrKind = "intrinsic" | "custom";

export type PageAttrBase = {
    id: string;
    kind: PageAttrKind;
    name: string;
    description: string | null;
};

type PageAttr_String = {
    type: "string";
    value: string | null;
};

type PageAttr_Number = {
    type: "number";
    value: number | null;
};

type PageAttr_Checkbox = {
    type: "checkbox";
    value: boolean;
};

type PageAttr_Select = {
    type: "select";
    value: string | null;
    options: string[];
};

export type PageAttr = PageAttrBase & (
    PageAttr_String |
    PageAttr_Number |
    PageAttr_Checkbox |
    PageAttr_Select
);