/* ============================================
   BIBLIOTECA DE PROJETOS — script.js
   (agora usando Supabase: banco de dados + storage de arquivos)
   ============================================ */

const SUPABASE_URL = "https://xeqkclytrgglvgahftyq.supabase.co";
const SUPABASE_KEY = "sb_publishable_U-r3Bqkuje-TV1X4KsN0PA_U2JeH7Gt";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET = "midias-projetos";
const ADMIN_PIN = "091224";

async function hashPin(pin) {
  const dados = new TextEncoder().encode(pin);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dados);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// pede pro usuário criar um PIN de 6 dígitos (usado ao cadastrar um projeto novo)
async function pedirCriacaoPin() {
  while (true) {
    const pin = prompt("Crie um PIN de 6 dígitos pra proteger este projeto (só quem souber esse PIN vai poder editar/excluir depois):");
    if (pin === null) return null;
    if (!/^\d{6}$/.test(pin)) {
      alert("O PIN precisa ter exatamente 6 dígitos numéricos.");
      continue;
    }
    const confirmacao = prompt("Confirme o PIN:");
    if (confirmacao === null) return null;
    if (pin !== confirmacao) {
      alert("Os PINs não coincidem. Tente de novo.");
      continue;
    }
    return await hashPin(pin);
  }
}

// pede o PIN pra confirmar uma ação (editar/excluir); aceita o PIN do projeto OU o PIN de admin
async function pedirVerificacaoPin(pinHashArmazenado, acao) {
  const pin = prompt(`Digite o PIN deste projeto pra ${acao} (ou o PIN de administrador):`);
  if (pin === null) return false;
  if (pin === ADMIN_PIN) return true;
  const hashDigitado = await hashPin(pin);
  if (hashDigitado === pinHashArmazenado) return true;
  alert("PIN incorreto.");
  return false;
}
const MAX_FOTOS = 10;
const MAX_VIDEOS = 5;
const MAX_DURACAO_VIDEO = 180; // segundos (3 minutos)

let listaProjetos = [];

// ---------- estado dos filtros ----------
const state = {
  busca: "",
  turma: "todas",
  techsAtivas: new Set(),
  somenteDestaque: false,
};

// ---------- estado do formulário (mídia + edição) ----------
// cada item de imagensSelecionadas: { tipo: "existente", url } ou { tipo: "novo", file, previewUrl }
let imagensSelecionadas = [];
// cada item de videosSelecionados: { tipo: "link", valor } ou { tipo: "arquivo-existente", valor } ou { tipo: "arquivo-novo", file, nome }
let videosSelecionados = [];
let edicaoId = null; // id do projeto sendo editado (null = criando novo)

// ---------- estado do carrossel do modal de detalhe ----------
let carouselMidias = [];
let carouselIndex = 0;

// ---------- elementos: catálogo ----------
const catalogEl      = document.getElementById("catalog");
const emptyStateEl   = document.getElementById("emptyState");
const searchInput    = document.getElementById("searchInput");
const turmaFilter    = document.getElementById("turmaFilter");
const techFiltersEl  = document.getElementById("techFilters");
const featuredOnly   = document.getElementById("featuredOnly");
const statTotal      = document.getElementById("statTotal");
const statTurmas     = document.getElementById("statTurmas");

// ---------- elementos: modal de detalhe ----------
const modalBackdrop  = document.getElementById("modalBackdrop");
const modalCardEl    = document.getElementById("modalCard");
const modalContent   = document.getElementById("modalContent");
const modalClose     = document.getElementById("modalClose");

// ---------- elementos: modal de formulário ----------
const btnAdicionar   = document.getElementById("btnAdicionar");
const formBackdrop   = document.getElementById("formBackdrop");
const formCardEl     = document.getElementById("formCard");
const formClose      = document.getElementById("formClose");
const formCancelar   = document.getElementById("formCancelar");
const formTitle      = document.getElementById("formTitle");
const projetoForm    = document.getElementById("projetoForm");
const fTurma         = document.getElementById("fTurma");
const fIntegrantes   = document.getElementById("fIntegrantes");
const fSala          = document.getElementById("fSala");
const fNome          = document.getElementById("fNome");
const fImagens       = document.getElementById("fImagens");
const previewImagens = document.getElementById("previewImagens");
const fVideoLink     = document.getElementById("fVideoLink");
const fVideoArquivo  = document.getElementById("fVideoArquivo");
const btnAddVideoLink    = document.getElementById("btnAddVideoLink");
const btnAddVideoArquivo = document.getElementById("btnAddVideoArquivo");
const videoAvisoErro = document.getElementById("videoAvisoErro");
const listaVideosEl  = document.getElementById("listaVideos");
const fDescricao     = document.getElementById("fDescricao");
const fTecnologias   = document.getElementById("fTecnologias");
const fRepo          = document.getElementById("fRepo");
const fDestaque      = document.getElementById("fDestaque");
const btnSalvarProjeto = projetoForm.querySelector('button[type="submit"]');

// ============================================
// INICIALIZAÇÃO
// ============================================

async function init() {
  registrarEventos();
  await carregarERenderizar();
}

function registrarEventos() {
  searchInput.addEventListener("input", (e) => {
    state.busca = e.target.value.trim().toLowerCase();
    renderizarCatalogo();
  });

  turmaFilter.addEventListener("change", (e) => {
    state.turma = e.target.value;
    renderizarCatalogo();
  });

  techFiltersEl.addEventListener("change", (e) => {
    state.techsAtivas.clear();
    if (e.target.value !== "todas") state.techsAtivas.add(e.target.value);
    renderizarCatalogo();
  });

  featuredOnly.addEventListener("change", (e) => {
    state.somenteDestaque = e.target.checked;
    renderizarCatalogo();
  });

  modalClose.addEventListener("click", fecharModal);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) fecharModal();
  });

  btnAdicionar.addEventListener("click", () => abrirFormulario());
  formClose.addEventListener("click", fecharFormulario);
  formCancelar.addEventListener("click", fecharFormulario);
  formBackdrop.addEventListener("click", (e) => {
    if (e.target === formBackdrop) fecharFormulario();
  });

  fImagens.addEventListener("change", processarImagens);
  btnAddVideoLink.addEventListener("click", adicionarVideoLink);
  btnAddVideoArquivo.addEventListener("click", adicionarVideoArquivo);
  projetoForm.addEventListener("submit", salvarProjeto);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { fecharModal(); fecharFormulario(); }
  });

  preencherFiltroTurmas();
  preencherSelectTurmasForm();
}

// ---------- busca os projetos no Supabase ----------
async function carregarERenderizar() {
  catalogEl.innerHTML = `<p class="loading-text">Carregando projetos...</p>`;
  emptyStateEl.hidden = true;

  const { data, error } = await sb
    .from("projetos")
    .select("*")
    .order("criado_em", { ascending: false });

  if (error) {
    console.error("Erro ao carregar projetos:", error);
    catalogEl.innerHTML = `<p class="loading-text">Não foi possível carregar os projetos. Verifique sua internet e recarregue a página.</p>`;
    return;
  }

  listaProjetos = data.map(linhaParaProjeto);
  preencherEstatisticas();
  preencherFiltroTechs();
  renderizarCatalogo();
}

// converte uma linha do banco (snake_case) pro formato usado no site
function linhaParaProjeto(row) {
  return {
    id: row.id,
    titulo: row.titulo,
    turma: row.turma,
    integrantes: row.integrantes || [],
    sala: row.sala || "",
    pinHash: row.pin_hash || null,
    tecnologias: row.tecnologias || [],
    descricaoCurta: row.descricao_curta || "",
    descricao: row.descricao || "",
    fotos: row.fotos || [],
    videos: row.videos || [],
    repoLink: row.repo_link || "",
    destaque: row.destaque || false,
  };
}

// converte o objeto do site pro formato do banco (snake_case)
function projetoParaLinha(p) {
  return {
    titulo: p.titulo,
    turma: p.turma,
    integrantes: p.integrantes,
    sala: p.sala,
    pin_hash: p.pinHash,
    tecnologias: p.tecnologias,
    descricao_curta: p.descricaoCurta,
    descricao: p.descricao,
    fotos: p.fotos,
    videos: p.videos,
    repo_link: p.repoLink,
    destaque: p.destaque,
  };
}

// ---------- estatísticas do header ----------
function preencherEstatisticas() {
  statTotal.textContent = listaProjetos.length;
  const turmasComProjeto = new Set(listaProjetos.map(p => p.turma));
  statTurmas.textContent = turmasComProjeto.size;
  document.getElementById("statTotalLabel").textContent = listaProjetos.length === 1 ? "projeto" : "projetos";
  document.getElementById("statTurmasLabel").textContent = turmasComProjeto.size === 1 ? "turma" : "turmas";
}

// ---------- select de turmas (filtro) ----------
function preencherFiltroTurmas() {
  TURMAS.forEach(turma => {
    const opt = document.createElement("option");
    opt.value = turma;
    opt.textContent = turma;
    turmaFilter.appendChild(opt);
  });
}

// ---------- select de turmas (formulário) ----------
function preencherSelectTurmasForm() {
  TURMAS.forEach(turma => {
    const opt = document.createElement("option");
    opt.value = turma;
    opt.textContent = turma;
    fTurma.appendChild(opt);
  });
}

// ---------- select de tecnologia (filtro) ----------
function preencherFiltroTechs() {
  techFiltersEl.innerHTML = `<option value="todas">Todas as tecnologias</option>`;
  const todasTechs = new Set();
  listaProjetos.forEach(p => (p.tecnologias || []).forEach(t => todasTechs.add(t)));

  [...todasTechs].sort().forEach(tech => {
    const opt = document.createElement("option");
    opt.value = tech;
    opt.textContent = tech;
    techFiltersEl.appendChild(opt);
  });

  const ativa = [...state.techsAtivas][0];
  techFiltersEl.value = ativa && todasTechs.has(ativa) ? ativa : "todas";
}

// ---------- filtragem ----------
function filtrarProjetos() {
  return listaProjetos.filter(p => {
    const alvoBusca = `${p.titulo} ${(p.integrantes || []).join(" ")} ${p.descricaoCurta || ""}`.toLowerCase();
    const passaBusca = alvoBusca.includes(state.busca);
    const passaTurma = state.turma === "todas" || p.turma === state.turma;
    const passaTechs = state.techsAtivas.size === 0 ||
      (p.tecnologias || []).some(t => state.techsAtivas.has(t));
    const passaDestaque = !state.somenteDestaque || p.destaque === true;
    return passaBusca && passaTurma && passaTechs && passaDestaque;
  });
}

// ---------- renderização dos cards ----------
function renderizarCatalogo() {
  const lista = filtrarProjetos();
  catalogEl.innerHTML = "";
  emptyStateEl.hidden = lista.length !== 0;

  lista.forEach((p) => {
    const card = document.createElement("article");
    card.className = "project-card";
    card.addEventListener("click", () => abrirModal(p));

    const capa = p.fotos && p.fotos.length > 0
      ? `<img src="${p.fotos[0]}" alt="Capa do projeto ${p.titulo}" loading="lazy">`
      : `<span>sem imagem de capa</span>`;

    const iconeStar = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>`;
    const iconePessoas = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5z"/><path d="M15.8 13.8c3.2-.4 5.7 1.4 5.7 4.2h-4.2c0-1.7-.6-3.1-1.5-4.2z"/></svg>`;

    card.innerHTML = `
      <div class="card-cover">
        ${capa}
        <span class="card-turma">${p.turma}</span>
        ${p.destaque ? `<span class="badge-destaque">${iconeStar} Destaque</span>` : ''}
      </div>
      <div class="card-body">
        <h3 class="card-title">${p.titulo}</h3>
        <p class="card-desc">${p.descricaoCurta || ""}</p>
        <div class="card-integrantes">
          <span class="card-integrantes-label">${iconePessoas} Desenvolvido por</span>
          <div class="card-nomes">${(p.integrantes || []).map(n => `<span>${n}</span>`).join("")}</div>
        </div>
        ${p.sala ? `<span class="card-sala">📍 ${p.sala}</span>` : ""}
        <div class="card-tags">
          ${(p.tecnologias || []).map(t => `<span>${t}</span>`).join("")}
        </div>
      </div>
    `;
    catalogEl.appendChild(card);
  });
}

// ============================================
// MODAL DE DETALHE (fotos + vídeos no mesmo carrossel)
// ============================================

function abrirModal(p) {
  const fotos = p.fotos || [];
  const videosArr = p.videos || [];

  carouselMidias = [
    ...fotos.map(f => ({ tipo: "foto", valor: f })),
    ...videosArr.map(v => ({ tipo: "video", valor: v.valor })),
  ];
  carouselIndex = 0;

  const carouselHTML = carouselMidias.length > 0 ? `
    <div class="modal-carousel">
      ${carouselMidias.length > 1 ? '<button class="carousel-arrow carousel-prev" id="carouselPrev" aria-label="Anterior">‹</button>' : ''}
      <div id="carouselSlide"></div>
      ${carouselMidias.length > 1 ? '<button class="carousel-arrow carousel-next" id="carouselNext" aria-label="Próximo">›</button>' : ''}
    </div>
    ${carouselMidias.length > 1 ? `<div class="carousel-dots" id="carouselDots"></div>` : ''}
  ` : "";

  const repoHTML = p.repoLink
    ? `<a class="modal-repo-link" href="${p.repoLink}" target="_blank" rel="noopener">Ver no GitHub →</a>`
    : `<span class="modal-no-repo">Repositório ainda não disponível</span>`;

  modalContent.innerHTML = `
    <span class="modal-meta">${p.turma}${p.sala ? ` · 📍 ${p.sala}` : ""}</span>
    <h2 class="modal-title">${p.titulo}</h2>
    <div class="modal-integrantes">
      <span class="modal-integrantes-label">Integrantes</span>
      <div class="card-nomes">${(p.integrantes || []).map(n => `<span>${n}</span>`).join("")}</div>
    </div>
    ${carouselHTML}
    <p class="modal-desc">${p.descricao || p.descricaoCurta || ""}</p>
    <div class="modal-tags">
      ${(p.tecnologias || []).map(t => `<span>${t}</span>`).join("")}
    </div>
    <div class="modal-footer">
      ${repoHTML}
      <div class="modal-footer-actions">
        <button class="btn-edit" id="btnEditarProjeto">Editar projeto</button>
        <button class="btn-excluir" id="btnExcluirProjeto">Excluir</button>
      </div>
    </div>
  `;

  if (carouselMidias.length > 0) {
    renderSlideAtual(p.titulo);

    if (carouselMidias.length > 1) {
      const dotsEl = document.getElementById("carouselDots");
      dotsEl.innerHTML = carouselMidias.map((_, i) =>
        `<button class="carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></button>`
      ).join("");

      document.getElementById("carouselPrev").addEventListener("click", () => {
        carouselIndex = (carouselIndex - 1 + carouselMidias.length) % carouselMidias.length;
        renderSlideAtual(p.titulo);
      });
      document.getElementById("carouselNext").addEventListener("click", () => {
        carouselIndex = (carouselIndex + 1) % carouselMidias.length;
        renderSlideAtual(p.titulo);
      });
      dotsEl.querySelectorAll(".carousel-dot").forEach(dot => {
        dot.addEventListener("click", () => {
          carouselIndex = Number(dot.dataset.index);
          renderSlideAtual(p.titulo);
        });
      });
    }
  }

  document.getElementById("btnEditarProjeto").addEventListener("click", async () => {
    const ok = await pedirVerificacaoPin(p.pinHash, "editar");
    if (!ok) return;
    fecharModal();
    abrirFormulario(p);
  });

  document.getElementById("btnExcluirProjeto").addEventListener("click", async () => {
    const ok = await pedirVerificacaoPin(p.pinHash, "excluir");
    if (!ok) return;
    excluirProjeto(p);
  });

  modalBackdrop.classList.add("open");
  document.body.style.overflow = "hidden";
  modalCardEl.scrollTop = 0;
}

function renderSlideAtual(titulo) {
  const midia = carouselMidias[carouselIndex];
  const slideEl = document.getElementById("carouselSlide");

  if (midia.tipo === "foto") {
    slideEl.innerHTML = `<img src="${midia.valor}" class="carousel-img" alt="Foto do projeto ${titulo}">`;
  } else {
    const idYoutube = extrairIdYoutube(midia.valor);
    slideEl.innerHTML = idYoutube
      ? `<iframe class="carousel-video" src="https://www.youtube.com/embed/${idYoutube}" title="Vídeo de ${titulo}" allowfullscreen></iframe>`
      : `<video class="carousel-video" src="${midia.valor}" controls></video>`;
  }

  const dotsEl = document.getElementById("carouselDots");
  if (dotsEl) {
    dotsEl.querySelectorAll(".carousel-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === carouselIndex);
    });
  }
}

function fecharModal() {
  modalBackdrop.classList.remove("open");
  document.body.style.overflow = "";
}

function extrairIdYoutube(url) {
  const regex = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// extrai o nome do arquivo a partir da URL pública do Supabase Storage
function nomeArquivoDaUrl(url) {
  const marcador = `/storage/v1/object/public/${BUCKET}/`;
  const indice = url.indexOf(marcador);
  if (indice === -1) return null;
  return url.slice(indice + marcador.length);
}

async function excluirProjeto(p) {
  const confirmar = confirm("Tem certeza que deseja excluir este projeto? Essa ação não pode ser desfeita.");
  if (!confirmar) return;

  // reúne os nomes de arquivo de todas as fotos e vídeos-arquivo desse projeto
  const arquivos = [
    ...(p.fotos || []),
    ...(p.videos || []).filter(v => v.tipo === "arquivo").map(v => v.valor),
  ]
    .map(nomeArquivoDaUrl)
    .filter(Boolean);

  if (arquivos.length > 0) {
    const { error: erroStorage } = await sb.storage.from(BUCKET).remove(arquivos);
    if (erroStorage) console.error("Erro ao apagar arquivos do Storage:", erroStorage);
    // segue mesmo se der erro aqui — melhor excluir o projeto do banco do que travar tudo
  }

  const { error } = await sb.from("projetos").delete().eq("id", p.id);
  if (error) {
    console.error("Erro ao excluir:", error);
    return;
  }

  fecharModal();
  await carregarERenderizar();
}

// ============================================
// FORMULÁRIO — ADICIONAR / EDITAR PROJETO
// ============================================

function abrirFormulario(projetoParaEditar = null) {
  resetarEstadoFormulario();

  if (projetoParaEditar) {
    edicaoId = projetoParaEditar.id;
    formTitle.textContent = "Editar Projeto";
    btnSalvarProjeto.textContent = "Salvar Alterações";

    fTurma.value = projetoParaEditar.turma || "";
    fIntegrantes.value = (projetoParaEditar.integrantes || []).join(", ");
    fSala.value = projetoParaEditar.sala || "";
    fNome.value = projetoParaEditar.titulo || "";
    fDescricao.value = projetoParaEditar.descricao || "";
    fTecnologias.value = (projetoParaEditar.tecnologias || []).join(", ");
    fRepo.value = projetoParaEditar.repoLink || "";
    fDestaque.checked = !!projetoParaEditar.destaque;

    imagensSelecionadas = (projetoParaEditar.fotos || []).map(url => ({ tipo: "existente", url }));
    videosSelecionados = (projetoParaEditar.videos || []).map(v =>
      v.tipo === "link"
        ? { tipo: "link", valor: v.valor }
        : { tipo: "arquivo-existente", valor: v.valor }
    );

    renderPreviewImagens();
    renderListaVideos();
  } else {
    edicaoId = null;
    formTitle.textContent = "Adicionar Projeto";
    btnSalvarProjeto.textContent = "Salvar Projeto";
  }

  formBackdrop.classList.add("open");
  document.body.style.overflow = "hidden";
  formCardEl.scrollTop = 0;
}

function fecharFormulario() {
  formBackdrop.classList.remove("open");
  document.body.style.overflow = "";
  resetarEstadoFormulario();
}

function resetarEstadoFormulario() {
  projetoForm.reset();
  imagensSelecionadas = [];
  videosSelecionados = [];
  edicaoId = null;
  previewImagens.innerHTML = "";
  listaVideosEl.innerHTML = "";
  esconderErroVideo();
}

function mostrarErroVideo(msg) {
  videoAvisoErro.textContent = msg;
  videoAvisoErro.hidden = false;
}

function esconderErroVideo() {
  videoAvisoErro.hidden = true;
  videoAvisoErro.textContent = "";
}

// ---------- imagens: até 10, acumulando, com opção de remover ----------
function processarImagens(e) {
  const arquivos = Array.from(e.target.files);
  const vagasRestantes = MAX_FOTOS - imagensSelecionadas.length;

  if (vagasRestantes <= 0) {
    alert(`Você já atingiu o limite de ${MAX_FOTOS} fotos.`);
    fImagens.value = "";
    return;
  }

  const aUsar = arquivos.slice(0, vagasRestantes);
  if (arquivos.length > vagasRestantes) {
    alert(`Só é possível adicionar mais ${vagasRestantes} foto(s). O limite é de ${MAX_FOTOS} fotos por projeto.`);
  }

  aUsar.forEach(file => {
    imagensSelecionadas.push({ tipo: "novo", file, previewUrl: URL.createObjectURL(file) });
  });

  renderPreviewImagens();
  fImagens.value = "";
}

function renderPreviewImagens() {
  previewImagens.innerHTML = "";
  imagensSelecionadas.forEach((item, index) => {
    const src = item.tipo === "existente" ? item.url : item.previewUrl;
    const wrap = document.createElement("div");
    wrap.className = "preview-thumb-wrap";
    wrap.innerHTML = `
      <img src="${src}" class="preview-thumb" alt="Prévia da imagem ${index + 1}">
      <button type="button" class="thumb-remove" title="Remover">✕</button>
    `;
    wrap.querySelector(".thumb-remove").addEventListener("click", () => {
      imagensSelecionadas.splice(index, 1);
      renderPreviewImagens();
    });
    previewImagens.appendChild(wrap);
  });
}

// ---------- vídeos: até 5, cada um até 3 minutos, acumulando ----------
function adicionarVideoLink() {
  esconderErroVideo();
  const link = fVideoLink.value.trim();
  if (!link) return;

  if (videosSelecionados.length >= MAX_VIDEOS) {
    mostrarErroVideo(`Limite de ${MAX_VIDEOS} vídeos por projeto atingido.`);
    return;
  }

  videosSelecionados.push({ tipo: "link", valor: link });
  fVideoLink.value = "";
  renderListaVideos();
}

function adicionarVideoArquivo() {
  esconderErroVideo();
  const arquivo = fVideoArquivo.files[0];
  if (!arquivo) return;

  if (videosSelecionados.length >= MAX_VIDEOS) {
    mostrarErroVideo(`Limite de ${MAX_VIDEOS} vídeos por projeto atingido.`);
    return;
  }

  const urlTemporaria = URL.createObjectURL(arquivo);
  const videoTeste = document.createElement("video");
  videoTeste.preload = "metadata";
  videoTeste.muted = true;
  videoTeste.playsInline = true;
  videoTeste.style.position = "fixed";
  videoTeste.style.width = "1px";
  videoTeste.style.height = "1px";
  videoTeste.style.opacity = "0";
  videoTeste.style.pointerEvents = "none";
  document.body.appendChild(videoTeste);

  let resolvido = false;

  function limparElementoTeste() {
    videoTeste.remove();
  }

  function processarComDuracao(duracao) {
    if (resolvido) return;
    resolvido = true;
    limparElementoTeste();

    if (!isFinite(duracao) || duracao <= 0) {
      URL.revokeObjectURL(urlTemporaria);
      mostrarErroVideo("Não foi possível determinar a duração desse vídeo. Tente outro arquivo.");
      fVideoArquivo.value = "";
      return;
    }

    if (duracao > MAX_DURACAO_VIDEO) {
      URL.revokeObjectURL(urlTemporaria);
      mostrarErroVideo(`Esse vídeo tem ${Math.round(duracao)}s. O limite é de 3 minutos (180s) por vídeo.`);
      fVideoArquivo.value = "";
      return;
    }

    videosSelecionados.push({ tipo: "arquivo-novo", file: arquivo, nome: arquivo.name });
    fVideoArquivo.value = "";
    renderListaVideos();
  }

  videoTeste.addEventListener("loadedmetadata", () => processarComDuracao(videoTeste.duration));
  videoTeste.addEventListener("durationchange", () => {
    if (videoTeste.duration && isFinite(videoTeste.duration)) processarComDuracao(videoTeste.duration);
  });
  videoTeste.addEventListener("error", () => {
    if (resolvido) return;
    resolvido = true;
    limparElementoTeste();
    URL.revokeObjectURL(urlTemporaria);
    mostrarErroVideo("Não foi possível ler esse arquivo de vídeo.");
    fVideoArquivo.value = "";
  });

  videoTeste.src = urlTemporaria;
  videoTeste.load();
}

function renderListaVideos() {
  listaVideosEl.innerHTML = "";
  videosSelecionados.forEach((v, index) => {
    const item = document.createElement("div");
    item.className = "video-item";
    const rotulo = v.tipo === "link" ? v.valor
      : v.tipo === "arquivo-novo" ? v.nome
      : "Vídeo já salvo";
    item.innerHTML = `<span>${rotulo}</span><button type="button">Remover</button>`;
    item.querySelector("button").addEventListener("click", () => {
      videosSelecionados.splice(index, 1);
      renderListaVideos();
    });
    listaVideosEl.appendChild(item);
  });
}

// ---------- upload de um arquivo pro Storage, retorna a URL pública ----------
async function subirArquivo(file) {
  const extensao = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const nomeArquivo = `${crypto.randomUUID()}.${extensao}`;

  const { error } = await sb.storage.from(BUCKET).upload(nomeArquivo, file, {
    cacheControl: "3600",
    upsert: false,
  });

  if (error) throw error;

  const { data } = sb.storage.from(BUCKET).getPublicUrl(nomeArquivo);
  return data.publicUrl;
}

// ---------- salvar (criar novo OU atualizar existente) ----------
async function salvarProjeto(e) {
  e.preventDefault();

  let pinHashFinal;
  if (edicaoId) {
    const projetoAntigo = listaProjetos.find(p => p.id === edicaoId);
    pinHashFinal = projetoAntigo ? projetoAntigo.pinHash : null;
  } else {
    const hash = await pedirCriacaoPin();
    if (!hash) return; // cancelou a criação do PIN, não salva o projeto
    pinHashFinal = hash;
  }

  btnSalvarProjeto.disabled = true;
  const textoOriginalBotao = btnSalvarProjeto.textContent;
  btnSalvarProjeto.textContent = "Enviando mídias...";

  try {
    // guarda o projeto antigo (se for edição) pra comparar o que foi removido
    const projetoAntigo = edicaoId ? listaProjetos.find(p => p.id === edicaoId) : null;

    // sobe as fotos novas (as que já eram do projeto continuam com a URL que já tinham)
    const fotosFinal = [];
    for (const item of imagensSelecionadas) {
      if (item.tipo === "existente") {
        fotosFinal.push(item.url);
      } else {
        const url = await subirArquivo(item.file);
        fotosFinal.push(url);
      }
    }

    // sobe os vídeos novos
    const videosFinal = [];
    for (const v of videosSelecionados) {
      if (v.tipo === "link") {
        videosFinal.push({ tipo: "link", valor: v.valor });
      } else if (v.tipo === "arquivo-existente") {
        videosFinal.push({ tipo: "arquivo", valor: v.valor });
      } else {
        const url = await subirArquivo(v.file);
        videosFinal.push({ tipo: "arquivo", valor: url });
      }
    }

    btnSalvarProjeto.textContent = "Salvando...";

    const dadosProjeto = {
      titulo: fNome.value.trim(),
      turma: fTurma.value,
      integrantes: fIntegrantes.value.split(",").map(n => n.trim()).filter(Boolean),
      sala: fSala.value.trim(),
      tecnologias: fTecnologias.value.split(",").map(t => t.trim()).filter(Boolean),
      descricaoCurta: fDescricao.value.trim().slice(0, 140),
      descricao: fDescricao.value.trim(),
      fotos: fotosFinal,
      videos: videosFinal,
      repoLink: fRepo.value.trim(),
      destaque: fDestaque.checked,
      pinHash: pinHashFinal,
    };

    const linha = projetoParaLinha(dadosProjeto);

    if (edicaoId) {
      const { error } = await sb.from("projetos").update(linha).eq("id", edicaoId);
      if (error) throw error;

      // apaga do Storage as mídias que existiam antes e não estão mais na versão nova
      if (projetoAntigo) {
        const urlsAntigas = [
          ...(projetoAntigo.fotos || []),
          ...(projetoAntigo.videos || []).filter(v => v.tipo === "arquivo").map(v => v.valor),
        ];
        const urlsNovas = new Set([
          ...fotosFinal,
          ...videosFinal.filter(v => v.tipo === "arquivo").map(v => v.valor),
        ]);
        const removidas = urlsAntigas
          .filter(url => !urlsNovas.has(url))
          .map(nomeArquivoDaUrl)
          .filter(Boolean);

        if (removidas.length > 0) {
          const { error: erroStorage } = await sb.storage.from(BUCKET).remove(removidas);
          if (erroStorage) console.error("Erro ao limpar mídias removidas:", erroStorage);
        }
      }
    } else {
      const { error } = await sb.from("projetos").insert(linha);
      if (error) throw error;
    }

    fecharFormulario();
    await carregarERenderizar();
  } catch (erro) {
    console.error("Erro ao salvar projeto:", erro);
    mostrarErroVideo("Não foi possível salvar o projeto. Verifique sua internet e tente novamente.");
  } finally {
    btnSalvarProjeto.disabled = false;
    btnSalvarProjeto.textContent = textoOriginalBotao;
  }
}

// ---------- start ----------
init();
// ---------- menu: destaca o link clicado ----------
document.querySelectorAll(".nav-link:not(#btnSobre)").forEach(link => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
    link.classList.add("active");
  });
});

// ---------- modal "Sobre" ----------
const sobreBackdrop = document.getElementById("sobreBackdrop");
const btnSobre      = document.getElementById("btnSobre");

function abrirSobre()  { sobreBackdrop.classList.add("open"); }
function fecharSobre() { sobreBackdrop.classList.remove("open"); }

btnSobre.addEventListener("click", (e) => { e.preventDefault(); abrirSobre(); });
document.getElementById("sobreClose").addEventListener("click", fecharSobre);
sobreBackdrop.addEventListener("click", (e) => { if (e.target === sobreBackdrop) fecharSobre(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharSobre(); });
