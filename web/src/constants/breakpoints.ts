/**
 * 断点常量。
 *
 * CSS 变量无法用于媒体查询，所以 CSS 里的断点只能是字面量。
 * 两处必须同步修改：这里，以及 styles/main.css 的 @media 查询。
 * 取值与 Element Plus 栅格对齐（sm=768 / lg=1200）。
 */
export const BP_MOBILE = 768
export const BP_SIDEBAR = 900
export const CONTENT_MAX = 1200