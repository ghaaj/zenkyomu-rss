import { JSDOM } from "jsdom";

const jsdom = new JSDOM();
export const { window } = jsdom;
export const domParser = new window.DOMParser();
