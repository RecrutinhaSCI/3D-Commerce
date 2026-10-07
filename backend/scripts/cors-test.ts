import { isOriginAllowed, corsOrigins, corsPreviewRegex } from '../src/config/env';

const cases = [
  'http://localhost:5173',
  'http://localhost:5173/',
  'https://3dcommerce.com.br',
  'https://3dcommerce.com.br/',
  'https://3d-commerce-gks23ej5h-recrutinha-sci-s-projects.vercel.app',
  'https://3d-commerce-abc123-recrutinha-sci-s-projects.vercel.app',
  'https://other-project-xyz-recrutinha-sci-s-projects.vercel.app',
  'https://3d-commerce-abc.some-other-user.vercel.app',
  'https://evil.com',
  'https://foo.vercel.app',
];
console.log('normalizedFixed=', corsOrigins);
console.log('previewRegex=', corsPreviewRegex);
for (const c of cases) console.log(isOriginAllowed(c) ? 'ALLOW ' : 'BLOCK ', c);
