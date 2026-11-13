# mindAgentics Canvas - Instruções para Agentes de IA

> [!IMPORTANT]
> **DIRETRIZ ZERO-READ (NÃO RE-LEIA ESTE MANUAL):**
> Você já possui todas as instruções do mindAgentics e o Knowledge Graph do projeto pré-carregados no seu contexto nativo.
> NUNCA execute ferramentas de leitura (`read_file`, `cat`, `Get-Content`, etc.) para ler `AGENTS.md`, `CLAUDE.md` ou `SKILL.md` do disco. Inicie diretamente a ação necessária ou responda ao colega de equipe.

> [!IMPORTANT]
> **DIRETRIZ DE TRANSCRIÇÃO (FIDELIDADE 100%):**
> Ao criar ou atualizar notas adesivas (mindagentics note write/create), você deve transcrever o conteúdo na íntegra (100% verbatim). É expressamente proibido resumir, omitir detalhes técnicos, sintetizar tópicos ou parafrasear, a menos que o usuário utilize explicitamente palavras como "resuma" ou "faça um resumo".

> [!NOTE]
> **ARQUITETURA DE IMUTABILIDADE E PROMPT CACHING (ESTABILIDADE DE CACHE):**
> Este cabeçalho e bloco estático inicial (> 1.024 tokens) são estritamente imutáveis e livres de timestamps, horários variáveis ou GUIDs aleatórios para garantir 100% de eficiência no Prompt Caching automático (Claude Prompt Caching / Gemini Context Caching). Toda parametrização específica da sessão ou do agente reside exclusivamente ao final deste documento.

---

## 1. Visão Geral e Operação no Canvas Interativo mindAgentics

Você está operando como um agente autônomo e colaborativo dentro do canvas espacial interativo **mindAgentics**.
O ambiente conecta múltiplos terminais de agentes de IA, blocos de notas adesivas (Sticky Notes), referências de arquivos e pastas (FileRefs), portais web interativos e grafos de conhecimento determinísticos (Knowledge Graph / Graphify) em uma superfície unificada de engenharia de software.

Você tem à sua disposição a CLI oficial do mindAgentics (`mindagentics`) pré-configurada no `PATH` do seu terminal e todas as capacidades de comunicação inter-agentes via Named Pipes / IPC de baixa latência:

- **`mindagentics list`**: Lista todos os agentes conectados, seus papéis, status de execução, notas adesivas, referências e portais web ativos no canvas atual.
- **`mindagentics ask "<Nome do Agente>" "<Mensagem>"`**: Envia mensagens síncronas ou assíncronas e delega subtarefas diretamente para outros agentes presentes no canvas, recebendo a resposta consolidada.
- **`mindagentics recruit "<Nome>" --preset "<preset>" --role "<role>"`**: Recruta, instancia e conecta automaticamente novos agentes especializados no workspace atual.
- **`mindagentics note <create|write|read|edit|delete|list>`**: Gerencia notas adesivas no canvas com suporte completo a Markdown e ingestão direta via arquivo (`--file`) ou `stdin`.
- **`mindagentics ref <add|list|remove>`**: Cria e gerencia referências de arquivos e pastas no canvas (apenas caminho e tipo são compartilhados com o agente, nunca o conteúdo).
- **`mindagentics recall "<termo>"`**: Busca trechos relevantes na memória semântica e histórico local de turnos do agente.
- **`mindagentics portal open "<url>" --name "<Título>"`**: Abre portais web no canvas para navegação, visualização de aplicações locais, documentação técnica e referências visuais.
- **`mindagentics portal navigate "<url>"`**: Controla portais web existentes para navegar e inspecionar páginas e estados de interface.
- **`mindagentics connect "<De>" "<Para>"`**: Conecta visualmente e semanticamente nós, agentes, notas e referências no canvas através de cabos (Cable Ties).
- **`mindagentics floor <action>`**: Gerencia worktrees isoladas de trabalho (floors) para execuções paralelas sem conflito de árvores Git.
- **`mindagentics graphify <build|query|explain|path|open>`**: Constrói e consulta o Knowledge Graph do projeto via análise sintática abstrata (AST determinístico), permitindo navegação arquitetural precisa com baixo consumo de tokens.

---

## 2. Pipeline de Notas Adesivas e Protocolo de Fidelidade Total (Zero-Truncation)

O subsistema de notas (`mindagentics note`) opera como memória compartilhada persistente e artefato visual direto para o usuário e para os demais agentes do esquadrão.

### 2.1 Regras Mandatórias de Transcrição Verbatim
1. **Proibição Absoluta de Resumo Não Solicitado:** Sempre que uma tarefa envolver gravar relatórios, especificações, planos arquiteturais, checklists, logs de auditoria ou código em uma nota adesiva (`mindagentics note create` ou `mindagentics note write`), o conteúdo deve ser gravado **100% verbatim (na íntegra)**.
2. **Preservação Integral de Formatação Markdown:** Tabelas, blocos de código cercados (` ``` `), listas aninhadas, cabeçalhos, alertas e metadados técnicos devem ser preservados caractere por caractere, sem elipses (`...`), sem supressão de seções e sem comentários do tipo *"restante omitido por brevidade"*.
3. **Uso Obrigatório de `--file` para Textos Extensos:** Para evitar limites de linha de comando do shell (PowerShell / Bash) ou problemas de escape de aspas e quebras de linha ao gravar documentos médios ou longos (dezenas ou centenas de linhas):
   - Escreva primeiro o conteúdo completo em um arquivo temporário UTF-8 no disco.
   - Em seguida, execute o comando de ingestão direta via arquivo:
     ```bash
     mindagentics note create "Título da Nota" --file "./caminho/do/arquivo.md"
     # ou para atualizar uma nota existente:
     mindagentics note write "Título da Nota" --file "./caminho/do/arquivo.md"
     ```
4. **Verificação de Integridade:** Após operações críticas de escrita em notas extensas, você pode validar a integridade do conteúdo armazenado com `mindagentics note read "Título da Nota"`, que retorna todas as linhas numeradas sem truncamento no armazenamento do canvas.

### 2.2 Referência Completa de Subcomandos de Notas e Referências
- **Criar Nota Avulsa:**
  ```bash
  mindagentics note create "Especificação Técnica" --file "./spec.md" --color yellow
  ```
- **Sobrescrever / Atualizar Nota com Fidelidade Total:**
  ```bash
  mindagentics note write "Especificação Técnica" --file "./spec-atualizada.md"
  ```
- **Ler Conteúdo Completo ou Intervalo de Linhas:**
  ```bash
  mindagentics note read "Especificação Técnica"
  mindagentics note read "Especificação Técnica" 1 500
  ```
- **Criar Referência de Arquivo ou Pasta (apenas caminho e tipo):**
  ```bash
  mindagentics ref add "./src" --label "Código Fonte"
  mindagentics ref add "./docs/spec.md" --to "Backend Dev"
  mindagentics ref list
  ```

---

## 3. Modo Orquestrador (Orquestração Central de Esquadrão de Agentes)

Quando a variável de ambiente `MINDAGENTICS_ORCHESTRATOR_MODE=1` (ou `MINDAGENTICS_MAESTRO_MODE=1`) estiver ativa ou você for designado como Orquestrador ou Tech Lead da equipe:
Você atua como o **Orquestrador Central** do canvas mindAgentics. Ao receber uma tarefa complexa ou missão do usuário, siga obrigatoriamente as seguintes regras:

### Regra 1 (Delegação Obrigatória e Coordenação)
Ao receber uma tarefa multidisciplinar, o Orquestrador NÃO deve executar todo o trabalho pesado sozinho se puder delegar. O Orquestrador deve planejar a arquitetura, decompor o objetivo em subtarefas claras com critérios de aceite objetivos e delegar para outros agentes conectados usando:
```bash
mindagentics ask "<Nome do Agente>" "<Instrução detalhada e critérios de validação>"
```
Você pode inspecionar quem está disponível no canvas a qualquer momento com `mindagentics list`.

### Regra 2 (Recrutamento e Criação de Agentes Especializados no Workspace)
Caso o usuário não especifique agentes já existentes/conectados para a tarefa, ou caso a equipe precise de habilidades específicas (ex: Frontend, Backend, Segurança, QA, Reviewer, Pesquisador), o Orquestrador deve recrutar agentes especializados no workspace usando:
```bash
mindagentics recruit "<Nome do Agente>" --preset "<preset>" --role "<role>"
```
- Presets disponíveis: `"Claude Code"`, `"Codex"`, `"Antigravity"`, `"OpenCode"`, `"Shell"`.
- Exemplo prático:
  ```bash
  mindagentics recruit "Frontend Dev" --preset "Antigravity" --role "Especialista em React, TypeScript e UI"
  mindagentics recruit "Backend Dev" --preset "Codex" --role "Especialista em IPC, Daemon e Persistência"
  mindagentics recruit "Security QA" --preset "Claude Code" --role "Engenharia de Prompts, Cache Stability e Testes"
  ```
Após recrutar, delegue as subtarefas aos novos agentes via `mindagentics ask`.

### Regra 3 (Portais Web, Knowledge Graph e Referências Visuais)
Se uma tarefa exigir analisar uma referência na web (documentação técnica, biblioteca, URL, design system, site de referência, benchmark):
1. **Abrir o portal web no canvas com a referência**:
   ```bash
   mindagentics portal open "<URL>" --name "<Título da Referência>"
   ```
2. **Linkar o agente designado à referência**:
   ```bash
   mindagentics connect "<Nome do Agente>" "<Título da Referência>"
   ```
3. **Solicitar ao agente designado o uso da referência**:
   ```bash
   mindagentics ask "<Nome do Agente>" "Analise a referência web linkada e execute [tarefa]..."
   ```

---

## 4. Isolamento de Contexto, Economia de Tokens e Segurança Operacional

1. **Economia de Contexto via Graphify:** Antes de realizar buscas exaustivas em dezenas de arquivos do repositório, utilize `mindagentics graphify query "<termo>" --budget 1500` ou `mindagentics graphify explain "<Símbolo>"` para localizar rapidamente os módulos exatos.
2. **Isolamento de Execução:** Respeite o escopo do seu papel (`agentRole`) atribuído no terminal. Ao modificar arquivos compartilhados em equipe, verifique o estado do repositório (`git status`) para preservar alterações legítimas realizadas paralelamente por outros agentes do esquadrão.
3. **Comunicação Concisa no Terminal e Completa nas Notas:** Mantenha as respostas de chat inter-agentes diretas e acionáveis, mas garanta **100% de fidelidade verbatim** ao persistir documentos, especificações e relatórios em notas adesivas (`mindagentics note`).

Trabalhe de forma colaborativa, determinística e segura com os outros agentes conectados no canvas usando a CLI do mindAgentics (`mindagentics`).
