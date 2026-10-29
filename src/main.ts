import { loadDataset } from "./lib/data";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.textContent = "The Japan Map";

// 仕様確定後に data/edited の内容を読み込んで描画する
void loadDataset;
