# Estilo de código

Este guia descreve o estilo **como ele é praticado** no repositório. Não há ESLint, Prettier, Biome, rustfmt.toml nem .editorconfig. O único gate é o `tsc` estrito do `npm run build`, então este documento é a referência.

## Geral

- **Idiomas.** Identificadores, comentários, títulos de teste e commits em inglês. Texto de UI, aria-labels, mensagens de erro ao usuário, frases de voz e persona em PT-BR ([ADR-0017](adr/0017-ui-pt-br-codigo-en.md)).
- **Formatação** que o código segue: aspas duplas, ponto e vírgula, vírgula final, linhas de até ~160 colunas.
- **Finais de linha.** O repositório mistura CRLF e LF, por exemplo `App.tsx`, `QuickDock.tsx` e `README.md` em CRLF.
  - Ao editar, preserve o final de linha do arquivo.
  - Edições em massa vão por script com substituição exata, que falha se o trecho não aparecer exatamente uma vez. Nunca por loops de pares no PowerShell.
- **Comentários explicam o porquê.** JSDoc `/** */` em quase todo export e campo, com exemplos em PT-BR e números medidos ("Small ~2,4 s"). No Rust, `//!` documenta o módulo e `///` os itens.
- **Contratos entre linguagens** levam `Mirrors \`X\` in <caminho>` no lado TypeScript ([ADR-0009](adr/0009-tipos-espelhados-ts-rust.md)).

## TypeScript / React

### Organização

| Onde | O quê | Exemplo |
|---|---|---|
| `src/components/` | Componentes `PascalCase.tsx`; kits com vários exports em minúsculas (`hud.tsx`, `widgets/tui.tsx`, `musicParts.tsx`, `editorChrome.tsx`) | `QuickDock.tsx` |
| `src/components/desktop/widgets/` | Um arquivo por widget | `WeatherWidget.tsx` |
| `src/components/desktop/apps/<app>/` | Uma pasta por app com `store.ts`, `types.ts` e `persist.ts` locais | `apps/ide/` |
| `src/hooks/use*.ts` | Estado React, timers, assinatura de eventos Tauri | `useWatchlist.ts` |
| `src/lib/*.ts` | Lógica pura, tipos de domínio, parsers e adaptadores. Hooks pequenos de preferência (`use*Prefs`) podem ficar ao lado do seu parser | `lib/tui.ts` |

- **Exports nomeados** em todo lugar. Só `App` (`App.tsx`) e os arquivos de config usam `default`. Imports lazy reembrulham: `.then((m) => ({ default: m.JarvisScene }))`.
- **TS estrito:** `strict`, `noUnusedLocals`, `noUnusedParameters` e `noFallthroughCasesInSwitch`.
- **Uniões discriminadas** espelham enums com tag do Rust (`AssistantEvent`).

### Persistência

Use sempre `src/lib/storage.ts`:

```ts
const [state, setState] = useStoredState("jarvis.<chave>", DEFAULT, parseX /*, delay = 250 */);
```

- Toda chave tem um `parse(raw: unknown): T | null` **tolerante**, que valida campo a campo e cai no padrão. Dado velho nunca quebra a UI.
- Dados que o usuário não pode perder usam `delay = 0`.
- Renomeações têm migração explícita (mapa `RENAMED`, chave `jarvis.migrations.*`).
- Lista de chaves: [persistence](../domain/persistence.md).

### Acesso ao backend (três níveis)

1. **Adaptador com fake de dev.** Um objeto `tauriBackend`; um `fakeBackend()` ativado por `window.__JARVIS_<X>__` e só presente com `import.meta.env.DEV`; ou `null`. Os fakes registram as chamadas em `__JARVIS_<X>_LOG__`. Exemplos: `assistant.ts`, `workspace.ts` (fake carregado dinamicamente de `workspaceFake.ts`), `terminal.ts` e `speech.ts`.
2. **Fallback inline.** `isTauri() ? invoke(...) : <alternativa no navegador>`. Exemplo: as settings, que vão para o localStorage.
3. **Indisponível.** O adaptador lança um erro, ou a UI mostra "Disponível no app desktop" (`feeds.ts`, `files.ts`, música).

Componentes não chamam `invoke` direto se já existe adaptador em `lib/`.

### Erros

- Erros são **valores**: `.catch(() => null)` / `.catch(() => [])`, ou `catch {}` **com comentário explicando** por que é seguro ignorar.
- Mensagens ao usuário saem com `String(error)`. Os códigos sentinela compartilhados com o Rust (`model-missing`, `file-changed`, `voice-missing`) são comparados por igualdade.

### Estilo visual

- Tailwind 4 inline com os tokens `hud-*` (`void`, `abyss`, `panel`, `cyan`, `holo`, `light`, `line`, `glow`, `text`, `alert`, `amber`) de `@theme` em `globals.css`. **Sem cores fixas.** O tema troca `--color-hud-*` em tempo de execução.
- Efeitos vêm das `@utility` próprias: `crt-*`, `superhot-*`, `tui-surface`, `tui-glow`, `tui-aberration`, `hud-input`, `hud-scroll`.
- O kit TUI (`BlockBar`, `KeyValue`, `ReverseRow`, `KeyHint`, `EditField`) fica em `components/desktop/widgets/tui.tsx`. Os controles de configuração ficam em `components/hud.tsx`.
- Ícones `lucide-react`, animação `motion`, fonte VT323.

### Acessibilidade e testabilidade

- Botões e controles têm nome acessível em PT-BR, que os testes usam como locator.
- `data-testid` em kebab-case, só quando não há papel/nome estável.
- O estado exposto para testes fica em `window.__JARVIS__` (`App.tsx`), com `signals.frames`, `hear`, `ask`, `voiceWindow`, `action`…

## Rust (`src-tauri/src`)

- Edition 2024 (`let`-chains permitidas).
- **Um módulo por domínio.** Submódulos usam `mod.rs` (`voice/`, `workspace/`, `git/`).
- **Comandos finos em `lib.rs`.** Nome `<domínio>_<verbo>`, e trabalho bloqueante dentro de `blocking()`. Ao criar um comando, registre-o no `invoke_handler` e documente em [ipc-contract](ipc-contract.md).
- **Estado.** Um único `AppState` gerenciado (`.manage`), com `Arc<RwLock<Settings>>` e um `Arc`/`Mutex` por subsistema.
- **Erros.** `Result<T, String>` em toda a base, sem `thiserror` nem `anyhow`. Conversão com `map_err(|e| e.to_string())`. Mensagens ao usuário em PT-BR.
- **Serde.** `#[serde(rename_all = "camelCase")]` em tudo que cruza o IPC. `#[serde(default)]` em structs persistidas.
- **Eventos.** Constantes `const EVENT_X: &str = "domínio:evento"`. Fluxos longos usam `tauri::ipc::Channel`. Bytes grandes (WAV) vão como `ipc::Response`.
- **Processos externos.** `CREATE_NO_WINDOW`, timeouts explícitos, sem shell intermediário quando possível (o `cmd /C start` do launcher é a exceção documentada).
- **Arquivos.** Escrita atômica (`.tmp` + rename, ou `ReplaceFileW` no workspace). Exclusões vão para a Lixeira (crate `trash`).
- **Testes** inline em `#[cfg(test)] mod tests`, com nomes em frase (`untouched_builtin_phrases_follow_the_new_defaults`). Os que dependem da máquina levam `#[ignore = "motivo"]`.

## Checklist de uma mudança

- [ ] Item novo (widget, app, feature, ADR) criado com `npm run new`, e o checklist de registro aplicado.
- [ ] Tipos espelhados atualizados nos dois lados (`Mirrors`).
- [ ] Novo estado persistido com parser tolerante e listado em [persistence](../domain/persistence.md).
- [ ] O adaptador funciona fora do Tauri (fake, fallback ou mensagem).
- [ ] Teste Playwright novo **incluído no `testMatch`** do projeto `ui` (`playwright.config.ts`).
- [ ] `spec.md` da pasta atualizado (componente, aceite, Código e Tarefas; Layout e Estilo se o TSX mudou). ADR novo se houve decisão.
- [ ] README intocado, salvo no máximo um bullet em "O que faz".
