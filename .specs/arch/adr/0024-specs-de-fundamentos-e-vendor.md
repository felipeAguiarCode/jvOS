# ADR-0024: Specs de fundamentos: arquitetura, stack e vendor

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-11-05 |
| **Origem** | conversa (2026-11-05): "quero specs dos fundamentos do app, arch, stack e em uma subpasta tudo que for lib ou modelos (vendor)" |
| **Spec** | [foundation/architecture](../../foundation/architecture/spec.md), [foundation/stack](../../foundation/stack/spec.md), `foundation/vendor/*` |

## Contexto

As specs cobriam o que o usuário vê (`features/`, `widgets/`, `apps/`), e a pasta `arch/` tinha documentos de referência: overview, constituição, contrato IPC, build. Faltavam três coisas:
- uma spec da arquitetura e da stack, com critérios que se possam conferir;
- um lugar para cada biblioteca e cada modelo de que o app depende. Os motivos de cada escolha estavam espalhados entre ADRs, o `build-and-env.md`, comentários do `Cargo.toml` e as memórias do projeto;
- um inventário completo. O app usa 36 pacotes npm diretos, 21 crates diretos, os modelos Whisper, o Silero VAD, as vozes Piper, o Kokoro e os modelos Claude, além de três programas externos (`claude.exe`, `yt-dlp`, `git`).

## Decisão

- **Abordagem escolhida:**
  - **Pasta `foundation/`:**
    - `foundation/architecture/spec.md`: as camadas e as regras que as separam;
    - `foundation/stack/spec.md`: as versões, o toolchain e os comandos;
    - `foundation/vendor/<id>/spec.md`: uma spec por item de fornecedor.
  - **Granularidade do vendor:** uma spec por **família** de pacotes que andam juntos (por exemplo `tauri`, `codemirror`, `three`), uma por **modelo** e uma por **ferramenta externa**. São 26 specs, e toda dependência direta do `package.json` e do `Cargo.toml` aparece em exatamente uma delas.
  - **Formato:** o mesmo do spec-coding.dev ([ADR-0023](0023-specs-formato-spec-coding-dev.md)), com o template `_templates/vendor.md`:
    - o cabeçalho traz o tipo, a versão resolvida no lock, a licença SPDX, a fonte e onde o item roda;
    - "Uso no jvOS" (RF) e "Restrições" (RNF) ficam entre os casos de borda e os entregáveis;
    - "Atualização e reversão" traz o comando, a prova e o sinal de volta.
  - **Ligação:** a seção `## Dependências` de cada feature, widget e app aponta para as specs de vendor que os arquivos dela realmente usam.
- **Por quê:** trocar uma lib ou um modelo passa a ter um lugar com a versão, a licença, os arquivos afetados, os testes que provam e o sinal de que é preciso voltar. As specs de arquitetura e de stack dão critérios conferíveis a regras que antes só estavam em prosa, como "componentes não chamam `invoke`" e "todo HTTP sai do Rust".
- **Alternativas rejeitadas:**
  - **Uma spec por pacote:** cerca de 65 arquivos, muitos sem conteúdo próprio (`@types/*`, `dunce`, `sha2`).
  - **Libs e modelos em subpastas separadas:** o pedido foi uma subpasta só, e os modelos dependem das libs que os rodam.
  - **Estender `arch/overview.md`:** o overview continua como referência com o diagrama, e a spec liga a ele em vez de repetir.

## Interfaces

- **Dados:** os arquivos novos ficam em `.specs/foundation/`. A tabela de fatos (versão declarada, resolvida, licença e quem usa) foi tirada dos locks, de `node_modules/*/package.json` e de `%USERPROFILE%\.cargo\registry`.

## Restrições

- **Compatibilidade:** nada em `arch/` foi movido nem apagado. A `foundation/` liga para lá.
- **Limites operacionais:** uma licença ou um motivo que não se confirma localmente (código, lock, registro, ADR, memória) leva `⚠ inferido — confirmar`.

## Plano de rollout

- **Fase 1:** template de vendor, specs de arquitetura e de stack.
- **Fase 2:** as 26 specs de vendor, escritas em paralelo a partir dos mesmos fatos, e as `## Dependências` das specs existentes.
- **Sinal de parada:** um link de vendor citado numa spec sem o arquivo correspondente.
- **Reversão:** apagar `.specs/foundation/` e as seções `## Dependências`. Nenhum código depende delas.

## Consequências

- **Positivas:**
  - Cada dependência tem dono, versão, licença e um caminho de atualização testável.
  - A stack e a arquitetura ganham critérios que um script ou uma conferência manual verificam.
- **Negativas / custos:**
  - As versões das specs de vendor envelhecem a cada `npm update` ou `cargo update`.
  - Mais 28 arquivos para manter.
- **Regras que daqui decorrem:**
  - Uma dependência nova entra na spec da família dela, ou numa spec de vendor nova, no mesmo commit.
  - Uma troca de versão atualiza a linha "Versão" da spec de vendor, e a de stack quando estiver na tabela.
  - Um modelo novo baixado pelo app ganha uma spec de vendor com a URL, o tamanho e o hash.

## Referências

- `.specs/_templates/vendor.md`
- [spec-coding.dev — Tools](https://spec-coding.dev/tools/)
- Specs afetadas: todas as de `features/`, `widgets/` e `apps/` (seção `## Dependências`)
