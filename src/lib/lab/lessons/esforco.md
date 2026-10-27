# Nível de esforço

Modelos de raciocínio podem **pensar antes de responder**: gerar tokens de raciocínio (montar a conta, testar hipóteses, conferir) antes da resposta final. O **nível de esforço** define quanto desse pensamento o modelo pode usar.

Conforme o fornecedor, o controle aparece como *effort*, *reasoning effort* ou *thinking budget*. Os níveis costumam ir de **low** a **high**, e algumas ferramentas oferecem degraus extras, como *xhigh* e *max*.

## O que muda com o esforço

| | Esforço baixo | Esforço alto |
|---|---|---|
| Tokens de raciocínio | poucos ou nenhum | muitos |
| Latência | rápida | lenta |
| Custo | baixo | alto (raciocínio é cobrado como saída) |
| Problemas de várias etapas | erra mais | acerta mais |
| Perguntas simples | resolve | resolve igual, mais caro |

## A armadilha da resposta rápida

> Um bastão e uma bola custam R$ 1,10 juntos. O bastão custa R$ 1,00 a mais que a bola. Quanto custa a bola?

A resposta que “parece” certa é R$ 0,10, e está errada. Com espaço para montar a equação, chega-se a R$ 0,05. Modelos sem raciocínio caem nas mesmas armadilhas que pessoas com pressa.

## Como escolher

- **Baixo**: perguntas factuais, classificação, formatação, conversas rápidas, tarefas em alto volume.
- **Médio**: o padrão razoável para a maior parte do trabalho.
- **Alto ou máximo**: matemática, planejamento com restrições, depuração difícil, decisões de arquitetura, tarefas longas de agente.

Regra prática: comece no **menor esforço que resolve** e suba só quando a qualidade pedir.

## No laboratório

Você vai fazer a mesma pergunta com esforço baixo e alto, comparar os níveis num problema de planejamento e ver que uma pergunta simples não precisa de mais.
