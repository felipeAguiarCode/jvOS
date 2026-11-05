# JARVIS OS

As specs, as decisões e as regras do projeto ficam em [`.specs/`](.specs/README.md). Leia o índice antes de mudar comportamento.

- **Uma spec por item:** cada pasta de `.specs/features|widgets|apps/` tem um único `spec.md` no formato SpecLang (dados, componentes com Comportamento/Layout/Estilo, voz), com os IDs US/RF/RNF/SC, o aceite, o mapa do código e as tarefas na mesma página.
- **Feature, widget, app ou ADR novo:** comece com `npm run new` (ou `npm run new -- <widget|app|feature|adr> <id> --yes …`; `--help` lista as flags). O CLI cria o `spec.md` a partir de `.specs/_templates/` e os esqueletos de código, sem editar nenhum arquivo existente. Depois, aplique o checklist de registro que ele imprime (está também em Tarefas › Fase 2 da spec).
- **Mudou comportamento:** atualize o `spec.md` da pasta: o bullet do componente, o aceite, o Código e as Tarefas. Se mudou contrato, atualize também `.specs/arch/ipc-contract.md` e `.specs/domain/persistence.md`.
- **Decisão de arquitetura:** crie um ADR novo em `.specs/arch/adr/` com o próximo número. Um ADR aceito não é editado; ele é substituído por outro.
- **Antes de codar:** siga `.specs/arch/constitution.md`, `coding-style.md` e `testing.md`. Um spec Playwright novo só roda se estiver no `testMatch` do projeto `ui`.
- **O README continua mínimo:** nada de tabelas de atalhos, frases, testes ou dados. Isso fica em `.specs`.
- **Idioma:** UI e specs em PT-BR; código, comentários e commits em inglês.
