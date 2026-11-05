# ADR-00xx: <Decisão em uma frase>

| | |
|---|---|
| **Status** | Proposto · Aceito · Substituído por ADR-00yy · Descontinuado |
| **Data** | AAAA-MM-DD |
| **Origem** | commit `<hash>` / memória / conversa |
| **Spec** | <as specs que esta decisão serve, com link> |

<!--
Formato do Design Doc do spec-coding.dev (https://spec-coding.dev/templates/sdd-design-doc), mais
Consequências e Referências. O comportamento do produto fica na spec; aqui ficam a escolha, os
trade-offs, as interfaces, as restrições e a ordem de entrada. Um ADR aceito não é editado: outro o
substitui. Apague as seções de Interfaces e Restrições que não se aplicam.
-->

## Contexto

As forças em jogo: restrições da máquina, requisitos, medições. Cite números e evidências (arquivo:linha, commit).

## Decisão

- **Abordagem escolhida:** o que foi decidido, no imperativo ("Usar…", "Manter…").
- **Por quê:** o motivo, com os números.
- **Alternativas rejeitadas:** só as que têm evidência. Se não houver registro, escreva "Não registradas".

## Interfaces

- **Comandos Tauri:** <novos ou alterados>
- **Eventos e Channels:** <…>
- **Dados:** <chaves `jarvis.*`, campos do `settings.json`, arquivos>
- **Estados da UI:** <o que o usuário vê em cada estado>

## Restrições

- **Compatibilidade:** <o que continua funcionando: dados salvos, builds sem a feature, modo web>
- **Segurança:** <confinamento, rede, permissões>
- **Desempenho:** <o orçamento, com o número medido>
- **Limites operacionais:** <máquina, tamanho, memória, dependências externas>

## Plano de rollout

- **Fase 1:** <o que entra primeiro>
- **Fase 2:** <o que entra depois>
- **Sinal de parada:** <a medição ou o erro que manda parar>
- **Reversão:** <como voltar atrás sem perder dados>

## Consequências

- **Positivas:** …
- **Negativas / custos:** …
- **Regras que daqui decorrem:** o que todo código novo deve respeitar.

## Referências

- `caminho/do/arquivo.rs`
- Specs afetadas: [features/...](../../features/.../spec.md)
