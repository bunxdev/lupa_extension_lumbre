# Lumbre para Lupa

Abre archivos Markdown en una pestaña de lectura. Permite arrastrar archivos, alternar texto crudo/renderizado y copiar el resultado. Complementa los archivos exportados por Cinder.

Versión de la extensión: **0.1.0**. Manifest V3, JavaScript sin paso de compilación.

## Instalar en Chromium

```sh
git clone https://github.com/bunxdev/lupa_extension_lumbre.git
```

Abre `chrome://extensions`, activa el modo desarrollador y carga la carpeta del repositorio como extensión desempaquetada.

## Instalar en Lupa

En Lupa 0.0.3 con Compose slim, clona este repositorio en `deploy/slim/.runtime/extensions/lumbre/` de tu instalación. En el Compose tradicional, usa `extensions/lumbre/`. El archivo debe quedar en `/extensions/lumbre/manifest.json` dentro del contenedor.

Lupa descubre los manifiestos al abrir un contexto de Chromium. Reabre el contexto en un momento apropiado, guardando antes el trabajo de la sesión. La descarga del repositorio no modifica las pestañas que ya están abiertas.

## Permisos y límites

- Permisos: ninguno declarado.
- Acceso a sitios: ninguno adicional declarado.

Usa un parser Markdown propio; no se promete compatibilidad completa con todas las extensiones de Markdown. No mantiene una lista de archivos recientes.

## Procedencia

Consulta [PROVENANCE.md](PROVENANCE.md). Esta publicación conserva el código instalado y añade documentación de distribución; no representa una batería nueva de pruebas contra sitios externos.

Licencia del proyecto: [MIT](LICENSE).
