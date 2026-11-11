export interface Course {
  id: string;
  title: string;
  slug: string;
  eyebrow: string;
  description: string;
  shortDescription: string;
  coverImage: string | null;
  levelLabel: string;
  originalPrice: number | null;
  price: number | null;
  externalUrl: string;
  buttonLabel: string;
  ctaType: 'external' | 'whatsapp';
  featured: boolean;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}
export type CourseInput = Omit<Course, 'id' | 'createdAt' | 'updatedAt'>;
