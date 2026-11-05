# Vendor: <Nome>

<Uma frase: o que é e para que o jvOS usa.>

| | |
|---|---|
| **ID** | `vendor/<pasta>` |
| **Tipo** | Lib npm · Crate Rust · Modelo · Ferramenta externa |
| **Status** | Em uso · Opcional · Removido |
| **Versão** | `pacote` 1.2.3 (declarada `^1.2`), uma linha por pacote; para modelo, o arquivo e o tamanho |
| **Licença** | <SPDX, tirada do `package.json` / `Cargo.toml` do pacote ou da página do modelo> |
| **Fonte** | <repositório ou site oficial; para modelo, a URL de onde o código baixa> |
| **Onde roda** | WebView2 · processo Rust · build · testes · processo externo |

<!--
Spec de um item de fornecedor (lib, família de libs, modelo ou ferramenta externa) no formato do
Feature Spec Generator do spec-coding.dev (https://spec-coding.dev/tools/): Objetivo, Não-objetivos,
Critérios de aceite, Casos de borda, Entregáveis (Output) e Dependências, com o uso no jvOS no meio.
- Os fatos (versão, licença, arquivos) vêm do lock, do registro e do código. Motivo que não está no
  código, num ADR, num commit ou nas memórias do projeto leva "⚠ inferido — confirmar".
- RF descreve como o jvOS usa o item (regra verificável, com DEVE); RNF, os limites (versão travada,
  tamanho, memória, offline, licença). Os números começam em 001 em cada spec.
- Critérios: binários, com o número real. Cada um cita entre parênteses o RF ou RNF que prova e vira
  um teste, uma checagem de build ou uma conferência manual. Cubra o caminho feliz, uma falha e um
  caso de borda.
-->

## Objetivo

Uma ou duas frases: o problema que o item resolve no jvOS e por que esta escolha (com o ADR, se houver).

## Não-objetivos

- <o que o jvOS não usa do item de propósito, ou o que ele não deve fazer aqui>

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** <estado inicial>
- **Quando** <ação>
- **Então** <resultado observável>.

### Critério 2 (RNF-001)

- **Dado** …
- **Quando** …
- **Então** ….

## Casos de borda

- **Vazio/nulo:** <o item falta (não instalado, não baixado, sem rede)> → <o que o jvOS faz>.
- **Duplicidade/idempotência:** <instalar ou baixar de novo, duas versões no lock> → <resultado>.
- **Concorrência/corrida:** <duas chamadas ao mesmo tempo, threads, processos> → <resultado>.
- **Permissões/visibilidade:** <licença, DLLs do sistema, pastas protegidas, rede> → <resultado>.

## Uso no jvOS

Uma seção `###` por ponto de integração.

### <Ponto de integração> (`<arquivo>`)

<O que faz com o item, em uma frase.>

- **Comportamento:**
  - **RF-001**: O jvOS DEVE <regra verificável sobre como o item é usado>.
  - Se <condição>, então <resultado>.

## Restrições

- **RNF-001**: <versão travada, tamanho, memória, offline, licença> (o número real).

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/...` | … |

### Testes

- `<comando>`: <o que prova>.

### Atualização e reversão

- **Comando:** `npm i <pacote>@<versão>` · `cargo update -p <crate> --precise <versão>` · <como baixar o modelo novo>
- **Prova:** <testes e checagens que precisam passar>
- **Sinal de volta:** <o que indica que é preciso voltar à versão anterior>
- **Reversão:** <como voltar: o comando e o que conferir>

### Decisões relacionadas

- [ADR-00xx — título](../../../arch/adr/00xx-....md)

## Dependências

- <outras specs de vendor, specs de feature e recursos do sistema de que este item depende>

## Pendências

- [ ] <lacuna real encontrada no código, com o caminho>
