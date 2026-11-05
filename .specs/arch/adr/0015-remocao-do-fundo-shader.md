# ADR-0015: Remoção dos fundos animados (grade e chuva Matrix)

| | |
|---|---|
| **Status** | Aceito · remoção commitada em `e7151cf` (2026-11-05) |
| **Data** | 2026-10-27 |
| **Origem** | remoção staged de `src/components/SceneBackground.tsx` e `src/shaders/background/*` (274 linhas) |

## Contexto

O núcleo 3D tinha um fundo selecionável, `Settings.background` = `solid` | `grid` | `matrix`, desenhado por `SceneBackground.tsx` com shaders próprios: `gridMaterial` (domo em grade), `matrixMaterial` + `glyphAtlas` (chuva Matrix) e `backdrop`. A opção "Fundo" ficava no Menu avançado.

> ⚠ inferido — confirmar: nem os commits nem o código registram o motivo. Pelo contexto, o fundo existia só no modo 3D, que deixou de ser o padrão ([ADR-0013](0013-nucleo-2d-padrao.md)), e somava custo de GPU e uma opção a mais sem efeito nos modos 2D/off.

## Decisão

- Remover os fundos. O fundo passa a ser sempre o preto do tema (`#000508`).
- Remover o campo `background` de `settings.rs` e `settings.ts`, a opção do `AdvancedMenu` e o uso em `JarvisScene.tsx`.
- O `settings.spec.ts` garante que não há mais fundo para escolher.

## Consequências

- **Positivas:** menos shaders, menos uma opção, o mesmo visual em todos os modos do núcleo.
- **Negativas:** perde-se o efeito visual para quem usava o 3D com grade ou Matrix.
- **Migração:** nenhuma é necessária. O `#[serde(default)]` sem `deny_unknown_fields` descarta o campo antigo do `settings.json` na próxima gravação.

## Alternativas consideradas

Não registradas.

## Referências

- `git show HEAD:src/components/SceneBackground.tsx` (código removido)
- Spec: [holographic-core](../../features/holographic-core/spec.md), [settings](../../features/settings/spec.md)
