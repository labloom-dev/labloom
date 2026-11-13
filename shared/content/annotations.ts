export const annotationColors = {
    yellow: { name: "黄色", value: "#F2D675" },
    green: { name: "绿色", value: "#A9C5A0" },
    purple: { name: "紫色", value: "#C5B6DC" },
    pink: { name: "粉色", value: "#F1B6A7" }
} as const;
export type AnnotationColor = keyof typeof annotationColors;