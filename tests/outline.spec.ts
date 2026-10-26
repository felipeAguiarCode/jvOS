import { expect, test } from "@playwright/test";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { MAX_SYMBOLS, outlineOf, symbolAt, type OutlineSymbol } from "../src/components/desktop/apps/ide/outline";

// Pure Node tests of jv_ide's Outline: no browser. Each sample is parsed with the same language
// support the editor loads (@codemirror/language-data), then read back as "kind name :line" rows
// indented by depth, so a failure shows the whole outline.

async function stateFor(language: string, doc: string) {
  const description = languages.find((candidate) => candidate.name === language);
  if (!description) throw new Error(`no language ${language}`);
  return EditorState.create({ doc, extensions: [await description.load()] });
}

const rows = (symbols: OutlineSymbol[]) => symbols.map((symbol) => `${"  ".repeat(symbol.depth)}${symbol.kind} ${symbol.name} :${symbol.line}`);

async function outline(language: string, doc: string) {
  return rows(outlineOf(await stateFor(language, doc), language));
}

/** termide's demo file (report.py), line for line. */
const REPORT_PY = `"""The daily reorder report: what each store should order today."""

import csv
import io

from .models import Store


def reorder_rows(store: Store) -> list[tuple]:
    """Items below their reorder point, most urgent first."""
    rows = []
    for item in sorted(store.items, key=lambda i: i.on_hand - i.reorder_point):
        if item.needs_reorder:
            rows.append((item.sku, item.name, item.on_hand, item.reorder_point))
    return rows


def to_csv(rows: list[tuple], delimiter: str = ",") -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=delimiter)
    writer.writerow(["sku", "name", "on_hand", "reorder_point"])
    writer.writerows(rows)
    return buffer.getvalue()


def render(store: Store) -> str:
    rows = reorder_rows(store)
    if not rows:
        return f"{store.city}: nothing to reorder"
    lines = [f"{store.city}: {len(rows)} item(s) to reorder"]
    for sku, name, on_hand, point, *_ in rows:
        lines.append(f"  {sku:<10} {name:<28} {on_hand:>4} / {point}")
    return "\\n".join(lines)
`;

test("Python: termide's report.py lists its three functions, and no locals", async () => {
  expect(await outline("Python", REPORT_PY)).toEqual(["f reorder_rows :9", "f to_csv :18", "f render :26"]);
});

test("Python: classes hold fields and methods; nested functions stay, locals and lambdas do not", async () => {
  const doc = `LIMIT = 10
a, b = 1, 2
count: int = 0

@dataclass
class Store:
    city: str = "x"
    items = []

    def total(self):
        local = 1
        def inner():
            pass
        return local

    async def load(self): ...

def main():
    handler = lambda x: x
`;
  expect(await outline("Python", doc)).toEqual([
    "v LIMIT :1",
    "v a :2",
    "v b :2",
    "v count :3",
    "c Store :6",
    "  v city :7",
    "  v items :8",
    "  m total :10",
    "    f inner :12",
    "  m load :16",
    "f main :18",
  ]);
});

const TS = `import { x } from "y";
export const answer = 42;
export const add = (a: number, b: number) => a + b;
const sub = function (a: number) { const hidden = a; return hidden; };
let local = 1, other = 2;
for (const item of []) {}
export function greet(name: string): string {
  const inner = 1;
  function nested() {}
  return name;
}
export default class Store<T> extends Base {
  items: T[] = [];
  #secret = 1;
  constructor() { super(); }
  get size() { return 1; }
  total(): number { return 0; }
  static create = () => new Store();
}
interface Shape { area(): number; name: string }
type Id = string | number;
enum Color { Red, Green }
namespace Util { export function help() {} }
export const Holder = class { field = 1; };
`;

test("TypeScript: functions held by constants, classes and their members, types and namespaces", async () => {
  expect(await outline("TypeScript", TS)).toEqual([
    "v answer :2",
    "f add :3",
    "f sub :4",
    "v local :5",
    "v other :5",
    "f greet :7",
    "  f nested :9",
    "c Store :12",
    "  v items :13",
    "  v #secret :14",
    "  m constructor :15",
    "  m size :16",
    "  m total :17",
    "  m create :18",
    "i Shape :20",
    "t Id :21",
    "t Color :22",
    "n Util :23",
    "  f help :23",
    "c Holder :24",
    "  v field :24",
  ]);
});

test("JavaScript, JSX and TSX share the same reading", async () => {
  const component = `export function App() {
  const [count] = useState(0);
  return <div>{count}</div>;
}
export const Button = ({ label }) => <button>{label}</button>;
`;
  const expected = ["f App :1", "f Button :5"];
  expect(await outline("JSX", component)).toEqual(expected);
  expect(await outline("TSX", component)).toEqual(expected);
  expect(await outline("JavaScript", "function a() {}\nconst b = async () => {};\nclass C { m() {} }\n")).toEqual(["f a :1", "f b :2", "c C :3", "  m m :3"]);
});

test("Rust: items, trait and impl methods, modules and macros", async () => {
  const doc = `use std::fmt;
const LIMIT: usize = 10;
static mut COUNT: u32 = 0;
pub struct Store { items: Vec<Item> }
pub enum Color { Red, Green }
pub trait Shape { fn area(&self) -> f64; fn name(&self) -> String { String::new() } }
type Id = u64;
impl fmt::Display for Store {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { let x = 1; Ok(()) }
}
impl<T> Store<T> where T: Clone { pub fn new() -> Self { Store { items: vec![] } } }
mod tests { fn helper() {} }
macro_rules! square { ($x:expr) => { $x * $x }; }
pub fn main() { const INNER: u8 = 1; fn inner() {} }
`;
  expect(await outline("Rust", doc)).toEqual([
    "v LIMIT :2",
    "v COUNT :3",
    "c Store :4",
    "t Color :5",
    "i Shape :6",
    "  m area :6",
    "  m name :6",
    "t Id :7",
    "c impl fmt::Display for Store :8",
    "  m fmt :9",
    "c impl Store<T> :11",
    "  m new :11",
    "n tests :12",
    "  f helper :12",
    "f square :13",
    "f main :14",
    "  f inner :14",
  ]);
});

test("Go: functions, methods, struct and interface types, package-level vars", async () => {
  const doc = `package main

const Limit = 10
var (
	count int
	name, title string
)
type Store struct { Items []Item }
type Shape interface { Area() float64 }
type ID int64
var handler = func() { var hidden int; _ = hidden }
func (s *Store) Total() int { x := 1; return x }
func Generic[T any](v T) T { return v }
func main() { var local = 1; _ = local }
`;
  expect(await outline("Go", doc)).toEqual([
    "v Limit :3",
    "v count :5",
    "v name :6",
    "v title :6",
    "c Store :8",
    "i Shape :9",
    "t ID :10",
    "v handler :11",
    "m Total :12",
    "f Generic :13",
    "f main :14",
  ]);
});

test("Java: classes, records, interfaces, enums, constructors, fields and nested types", async () => {
  const doc = `package demo;
public class Store<T> extends Base implements Shape {
    private final int limit = 10, max = 20;
    public Store() { super(); }
    public int total() { int x = 1; return x; }
    static class Inner { void run() {} }
    interface Listener { void on(); }
    enum Mode { A, B }
}
record Point(int x, int y) { int sum() { return x + y; } }
@interface Marker { String value(); }
`;
  expect(await outline("Java", doc)).toEqual([
    "c Store :2",
    "  v limit :3",
    "  v max :3",
    "  m Store :4",
    "  m total :5",
    "  c Inner :6",
    "    m run :6",
    "  i Listener :7",
    "    m on :7",
    "  t Mode :8",
    "c Point :10",
    "  m sum :10",
    "i Marker :11",
  ]);
});

test("C++ and C: namespaces, classes with inline and out-of-line methods, operators", async () => {
  const doc = `#include <vector>
namespace inv {
struct Item { int qty; };
class Store {
public:
    Store();
    int total() const { return 0; }
    ~Store() {}
};
enum class Color { Red, Green };
int Store::count() { return 1; }
static int *make(int n) { return nullptr; }
bool operator==(const Item& a, const Item& b) { return true; }
}
union U { int a; float b; };
struct Fwd;
int main(int argc, char** argv) { return 0; }
`;
  expect(await outline("C++", doc)).toEqual([
    "n inv :2",
    "  c Item :3",
    "  c Store :4",
    "    m total :7",
    "    m ~Store :8",
    "  t Color :10",
    "  m Store::count :11",
    "  f make :12",
    "  f operator== :13",
    "c U :15",
    "f main :17",
  ]);
  expect(await outline("C", "struct point { int x; };\nint add(int a, int b) { return a + b; }\n")).toEqual(["c point :1", "f add :2"]);
});

test("PHP: namespace, functions, classes, traits, enums, constants and properties", async () => {
  const doc = `<?php
namespace App\\Models;
const LIMIT = 10;
function helper($x) { $y = 1; return $x; }
interface Shape { public function area(): float; }
trait Named { public function name() { return ""; } }
enum Suit: string { case Hearts = 'H'; }
abstract class Store extends Base implements Shape {
    const VERSION = "1";
    private int $count = 0, $max = 5;
    public function __construct() {}
    public static function create(): static { return new static(); }
}
`;
  expect(await outline("PHP", doc)).toEqual([
    "n App\\Models :2",
    "v LIMIT :3",
    "f helper :4",
    "i Shape :5",
    "  m area :5",
    "i Named :6",
    "  m name :6",
    "t Suit :7",
    "c Store :8",
    "  v VERSION :9",
    "  v $count :10",
    "  v $max :10",
    "  m __construct :11",
    "  m create :12",
  ]);
});

test("CSS family: selectors nest, at-rules, keyframes, mixins and top-level variables", async () => {
  const scss = `$primary: #0ff;
@mixin glow($c) { box-shadow: 0 0 4px $c; }
.panel, .card > h1 {
  color: red;
  $local: 1px;
  &:hover { color: blue; }
  .title { font-weight: bold; }
}
@media (max-width: 600px) { .panel { display: none; } }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
`;
  expect(await outline("SCSS", scss)).toEqual([
    "v $primary :1",
    "f glow :2",
    "k .panel, .card > h1 :3",
    "  k &:hover :6",
    "  k .title :7",
    "k @media (max-width: 600px) :9",
    "  k .panel :9",
    "k @keyframes spin :10",
  ]);
  expect(await outline("CSS", ":root { --x: 1; }\na:hover,\na:focus { color: red; }\n")).toEqual(["k :root :1", "k a:hover, a:focus :2"]);
  expect(await outline("Sass", ".panel\n  color: red\n  .title\n    font-weight: bold\n=glow($c)\n  box-shadow: 0 0 $c\n")).toEqual([
    "k .panel :1",
    "  k .title :3",
    "f glow :5",
  ]);
  expect(await outline("LESS", "@primary: #0ff;\n.mixin(@c) { color: @c; }\n.panel { .title { color: red; } }\n")).toEqual([
    "v @primary :1",
    "k .mixin(@c) :2",
    "k .panel :3",
    "  k .title :3",
  ]);
});

test("Markdown: ATX and setext headings, nested by level", async () => {
  const doc = "# Guide\n\nIntro\n\n## Install ##\n\nSetext Title\n============\n\nSub\n---\n\n### Deep `code`\n";
  expect(await outline("Markdown", doc)).toEqual(["h Guide :1", "  h Install :5", "h Setext Title :7", "  h Sub :10", "    h Deep `code` :13"]);
});

test("JSON and YAML: keys three levels deep", async () => {
  const json = `{
  "name": "x",
  "scripts": { "dev": "vite", "nested": { "deep": { "deeper": 1 } } },
  "list": [ { "in\\u0041rray": 1 } ]
}
`;
  expect(await outline("JSON", json)).toEqual([
    "k name :2",
    "k scripts :3",
    "  k dev :3",
    "  k nested :3",
    "    k deep :3",
    "k list :4",
    "  k inArray :4",
  ]);
  const yaml = "name: demo\nservices:\n  web:\n    image: nginx\n    ports:\n      - \"80:80\"\n    deploy:\n      replicas: 2\nlist:\n  - a: 1\n";
  expect(await outline("YAML", yaml)).toEqual([
    "k name :1",
    "k services :2",
    "  k web :3",
    "    k image :4",
    "    k ports :5",
    "    k deploy :7",
    "k list :9",
    "  k a :10",
  ]);
});

test("C# (a legacy stream mode) is read line by line, nesting by indentation", async () => {
  const doc = `using System;
namespace Inventory.Core
{
    // public class Commented {}
    public sealed class Store : IStore
    {
        private readonly List<Item> _items = new List<Item>();
        public int Count { get; set; }
        public Store() { }
        public async Task<int> TotalAsync(int limit)
        {
            var local = 1;
            if (limit > 0) { return local; }
            return 0;
        }
        public static Store Create() => new Store();
    }
    public interface IStore { }
    internal enum Mode { A, B }
    public record Point(int X, int Y);
}
`;
  expect(await outline("C#", doc)).toEqual([
    "n Inventory.Core :2",
    "  c Store :5",
    "    v _items :7",
    "    v Count :8",
    "    m Store :9",
    "    m TotalAsync :10",
    "    m Create :16",
    "  i IStore :18",
    "  t Mode :19",
    "  c Point :20",
  ]);
});

test("the other legacy languages: Kotlin, Ruby, Shell, PowerShell, Lua, Swift, Dart, SQL, TOML, Dockerfile", async () => {
  expect(
    await outline(
      "Kotlin",
      "package demo\nval VERSION = \"1\"\ndata class Store(val city: String) {\n    val items = mutableListOf<Item>()\n    fun total(): Int {\n        val local = 1\n        return local\n    }\n}\ninterface Shape\nenum class Color { RED }\nfun String.shout() = uppercase()\ntypealias Id = Long\n",
    ),
  ).toEqual(["v VERSION :2", "c Store :3", "  v items :4", "  m total :5", "i Shape :10", "t Color :11", "f shout :12", "t Id :13"]);
  expect(
    await outline("Ruby", "module Shop\n  LIMIT = 5\n  class Store < Base\n    attr_reader :items\n    def total\n      local = 1\n    end\n    def self.build; end\n  end\nend\n"),
  ).toEqual(["n Shop :1", "  v LIMIT :2", "  c Store :3", "    v items :4", "    m total :5", "    m self.build :8"]);
  expect(await outline("Shell", "#!/bin/bash\n# helper() {}\nbuild() {\n  echo hi\n}\nfunction deploy {\n  build\n}\n")).toEqual(["f build :3", "f deploy :6"]);
  expect(
    await outline(
      "PowerShell",
      "function Get-Report {\n    param([string]$Path)\n}\nclass Store {\n    [int]$Count\n    [int] Total() { return 0 }\n}\nenum Mode { A }\n",
    ),
  ).toEqual(["f Get-Report :1", "c Store :4", "  v Count :5", "  m Total :6", "t Mode :8"]);
  expect(await outline("Lua", "local M = {}\nfunction M.load(path)\nend\nlocal save = function(x) end\nfunction obj:method() end\n")).toEqual([
    "f M.load :2",
    "f save :4",
    "f obj:method :5",
  ]);
  expect(
    await outline(
      "Swift",
      "import Foundation\nlet version = 1\nstruct Store {\n    var items: [Item] = []\n    init(items: [Item]) { self.items = items }\n    func total() -> Int {\n        let local = 1\n        return local\n    }\n    class func make() -> Store { Store(items: []) }\n}\nprotocol Shape {}\nenum Color { case red }\nextension Store: Shape {}\n",
    ),
  ).toEqual(["v version :2", "c Store :3", "  v items :4", "  m init :5", "  m total :6", "  m make :10", "i Shape :12", "t Color :13", "c Store :14"]);
  expect(
    await outline(
      "Dart",
      "const limit = 10;\nclass Store {\n  final List<Item> items = [];\n  Store(this.city) {}\n  int total() {\n    final local = 1;\n    if (local > 0) {\n      return local;\n    }\n    return 0;\n  }\n  int get size => items.length;\n}\nenum Color { red }\nvoid main() => runApp();\n",
    ),
  ).toEqual(["v limit :1", "c Store :2", "  v items :3", "  m Store :4", "  m total :5", "  m size :12", "t Color :14", "f main :15"]);
  expect(
    await outline(
      "SQL",
      "-- create table commented (id int);\nCREATE TABLE IF NOT EXISTS public.items (id int);\ncreate or replace view \"stock\" as select 1;\nCREATE FUNCTION reorder() RETURNS int AS $$ select 1 $$;\ncreate unique index items_sku on items (sku);\n",
    ),
  ).toEqual(["c public.items :2", "c stock :3", "f reorder :4", "k items_sku :5"]);
  expect(await outline("TOML", "title = \"demo\"\n[package]\nname = \"jarvis\"\n\"quoted key\" = 1\n[[bin]]\nname = \"cli\"\n")).toEqual([
    "k title :1",
    "n package :2",
    "  k name :3",
    "  k quoted key :4",
    "n bin :5",
    "  k name :6",
  ]);
  expect(
    await outline("Dockerfile", "ARG NODE=22\nFROM node:22 AS build\nENV CI=1\nWORKDIR /app\nRUN npm ci\nFROM nginx:alpine\nEXPOSE 80\nCMD [\"nginx\"]\n"),
  ).toEqual(["v NODE :1", "n build :2", "  v CI :3", "  k WORKDIR :4", "n nginx:alpine :6", "  k EXPOSE :7", "  k CMD :8"]);
});

test("symbolAt finds the innermost symbol on or before the cursor's line", async () => {
  const report = outlineOf(await stateFor("Python", REPORT_PY), "Python");
  expect(symbolAt(report, 1)).toBeNull();
  expect(symbolAt(report, 9)?.name).toBe("reorder_rows");
  expect(symbolAt(report, 13)?.name).toBe("reorder_rows");
  expect(symbolAt(report, 20)?.name).toBe("to_csv");
  expect(symbolAt(report, 999)?.name).toBe("render");

  const nested = outlineOf(await stateFor("TypeScript", TS), "TypeScript");
  expect(symbolAt(nested, 17)).toMatchObject({ kind: "m", name: "total", depth: 1 });
  // Two symbols start on line 23 (the namespace and its function): the deeper one wins.
  expect(symbolAt(nested, 23)).toMatchObject({ name: "help", depth: 1 });
  expect(symbolAt([], 5)).toBeNull();
});

test("limits: no language, unknown languages and huge documents give nothing; long outlines stop at the cap", async () => {
  const state = await stateFor("Python", REPORT_PY);
  expect(outlineOf(state, null)).toEqual([]);
  expect(outlineOf(state, "Brainfuck")).toEqual([]);
  // The `from` of a symbol points at its name.
  const [first] = outlineOf(state, "Python");
  expect(state.doc.sliceString(first.from, first.from + first.name.length)).toBe("reorder_rows");

  const huge = EditorState.create({ doc: `def big():\n    pass\n${"#".repeat(2 * 1024 * 1024)}\n` });
  expect(outlineOf(huge, "Python")).toEqual([]);

  const keys = Array.from({ length: MAX_SYMBOLS + 500 }, (_, i) => `key${i} = ${i}`).join("\n");
  const capped = outlineOf(EditorState.create({ doc: keys }), "TOML");
  expect(capped).toHaveLength(MAX_SYMBOLS);
  expect(capped[MAX_SYMBOLS - 1].name).toBe(`key${MAX_SYMBOLS - 1}`);
});
