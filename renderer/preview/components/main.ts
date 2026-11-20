import { mount } from "svelte";
import "../../styles/layouts.css";
import "../../styles/colors.css";
import "../../styles/base.css";
import "../../styles/elements.css";
import "../../styles/workspace.css";
import "./catalog.css";
import Catalog from "./Catalog.svelte";
import OverlayExample, { overlayNames } from "./OverlayExample.svelte";

const target = document.querySelector<HTMLElement>("#catalog")!;
const params = new URLSearchParams(location.search);
const sample = overlayNames.find(name => name === params.get("sample"));
if (sample) {
    document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
    document.documentElement.dataset.motion = params.get("motion") === "off" ? "off" : "on";
    document.body.classList.add("specimen");
    mount(OverlayExample, { target, props: { sample, expanded: true } });
}
else {
    mount(Catalog, { target });
}