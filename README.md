# Faceplate

App web (PWA) de campo para tablet/celular: ajuda o instrumentista no PDS
**"Verificar FT/PT com indicação incoerente no faceplate"**.

Compara **instrumento (Trex) × entrada do SDCD × faceplate** e mostra se as faixas são
equivalentes, se há divergência ou se faltam dados ("Dados insuficientes" + o campo que falta).
É só conferência e simulação na tela — nada é configurado no instrumento nem no SDCD.

## Como usar
1. Anote com o operador: TAG, variável, unidade, faixa e valor do faceplate.
2. Preencha **Instrumento** (variável de saída, unidade, 4 mA/20 mA, leitura atual, folha de dados se tiver).
3. Preencha **Entrada do SDCD** (4–20 mA, HART digital ou "não sei"; escala; bloco de cálculo) e marque
   "conferi" só quando tiver visto na configuração. Sem isso o resultado aparece como **hipótese**, com a lista do que confirmar.
4. O app mostra: faixa atual do Trex, **faixa equivalente à escala do SDCD** (na unidade do instrumento,
   em 4 e 20 mA), faixa da folha de dados, conferência em 4/8/12/16/20 mA, corrente esperada pela leitura
   e o que o Trex deveria ler com o valor que o operador vê.

Botão **Exemplo** carrega o caso de teste: faceplate 0–100.000 L/h × FT 0–150 m³/h → faixa equivalente
0–100 m³/h, divergência em 20 mA; em 12 mA o FT = 75 m³/h e o faceplate = 50.000 L/h = 50 m³/h.

## Regras de cálculo (`calc.js`)
- Entrada analógica linear: fração = (mA − 4) ÷ 16; valor = início + fração × (fim − início).
- Mesma variável, unidade diferente: converte os dois limites antes de comparar.
- ΔP × vazão: pede a vazão correspondente a 20 mA e onde a raiz é extraída.
  Raiz no transmissor → SDCD lê sinal proporcional à vazão; saída linear em ΔP → a raiz entra no cálculo do SDCD.
  Faixa de ΔP equivalente assume Q = k·√ΔP (zero-based), com k do par ΔP ↔ vazão informado.
  Avisa raiz dupla / raiz ausente.
- HART digital: pede variável selecionada e conversão; a faixa 4–20 mA não altera a leitura.
- Tolerância de comparação: 0,5 % do span do faceplate.
- Números: vírgula ou ponto nos decimais; `100.000` = cem mil. mmH₂O/cmH₂O/inH₂O a 4 °C.
- Vazão volumétrica × mássica × normal não se convertem (exigem densidade/condições) → "Dados insuficientes".

## Estrutura
`index.html` (interface) · `calc.js` (motor, sem DOM) · `test/calc.test.js` · `sw.js` + `manifest.webmanifest` (offline/instalável)

```bash
node --test test/
```

Dados ficam só no navegador do aparelho.
