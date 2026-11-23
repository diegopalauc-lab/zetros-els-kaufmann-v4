# Zetros ELS-Kaufmann V4

## 1. Sube el proyecto desde GitHub web

1. Extrae el ZIP. Crea un repositorio **privado** en GitHub llamado
   `zetros-els-kaufmann-v4`, sin marcar **Add README**.
2. En ese repositorio, usa **uploading an existing file** si está vacío.
   En las cargas siguientes, entra a **Code → Add file → Upload files**.
3. En Windows abre `01_FOTOS`. Arrastra solo su carpeta `public` al cuadro
   de carga y pulsa **Commit changes**. Repite desde la portada del mismo
   repositorio con `02_FOTOS`, `03_FOTOS`, `04_FOTOS` y `05_FOTOS`, un lote por vez.
4. Abre `06_TABLERO` y arrastra todos los archivos y carpetas que hay dentro.
   Guarda el último commit en la rama `main`.
5. En la portada del repositorio deben verse `wrangler.jsonc`, `package.json`
   y las carpetas `public`, `scripts` y `src`.

## 2. Publica en Cloudflare

En **Workers & Pages → Create application → GitHub**, selecciona el repositorio nuevo.

| Campo | Valor |
|---|---|
| Worker name | `zetros-els-kaufmann-v4` |
| Production branch | `main` |
| Root directory | Dejar vacío |
| Build command | Dejar vacío |
| Deploy command | `npm run deploy` |

Pulsa **Deploy**. El registro debe mostrar `Verificación correcta: 96 fotos de referencia y ambos logos.` y después `Success! Build completed`. Si falta una imagen, el despliegue se detiene y el registro indica su ruta. La configuración solicita una base D1 nueva llamada `zetros-ctz15-v4`.

## 3. Crea el enlace privado

Abre PowerShell y pega esta línea:

```powershell
$b = New-Object byte[] 32; $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($b); $rng.Dispose(); [BitConverter]::ToString($b).Replace('-', '').ToLowerInvariant()
```

En el Worker nuevo, ve a **Settings → Runtime variables and secrets → Add variable**. Marca **Production** y **Secret**. En **Key**, escribe `ZETROS_ACCESS_KEY`. En **Value**, pega los 64 caracteres que generaste. Pulsa **Add variable and deploy**.

Abre una ventana de incógnito. Pega la URL nueva de Cloudflare, añade `/#acceso=` y pega la misma clave a continuación. Guarda el enlace completo antes de entrar. Escribe tu nombre y comprueba los 70 ítems, los dos logos y las fotos de **12.1** y **23.1**.

La sesión del navegador dura siete días. El equipo puede volver a entrar con el mismo enlace.
