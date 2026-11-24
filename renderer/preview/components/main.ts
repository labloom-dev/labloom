import "../../styles/global.css";
import { mount } from "svelte";
import "./catalog.css";
import Catalog from "./Catalog.svelte";
import EditorExample from "./EditorExample.svelte";
import OverlayExample, { overlayNames } from "./OverlayExample.svelte";
import { setLocale } from "../../i18n.svelte";

const target = document.querySelector<HTMLElement>("#catalog")!;
const params = new URLSearchParams(location.search);
if (params.get("lang") === "en") setLocale("en");
const sample = overlayNames.find(name => name === params.get("sample"));
if (sample || params.get("sample") === "editor") {
    document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
    document.documentElement.dataset.motion = params.get("motion") === "off" ? "off" : "on";
    document.body.classList.add("specimen");
    if (sample) mount(OverlayExample, { target, props: { sample, expanded: true } });
    else mount(EditorExample, { target, props: { focusOnOpen: true } });
}
else {
    mount(Catalog, { target });
}