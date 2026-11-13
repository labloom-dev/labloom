import { mount } from "svelte";
import App from "./components/layout/App.svelte";
import { connectAPI } from "../shared/failure";
import { type AppAPI } from "../shared/app";

window.api = connectAPI<AppAPI>(window.bridge);

const app = mount(App, {
    target: document.getElementById("app")!
});

export default app;