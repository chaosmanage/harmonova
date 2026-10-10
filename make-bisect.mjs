import fs from "node:fs";
let src = fs.readFileSync("tests/lists.mjs", "utf8");
src = src.replace(/await test\("empty submissions list[\s\S]*$/, "");
fs.writeFileSync("tests/bisect1.mjs", src);
console.log("written");