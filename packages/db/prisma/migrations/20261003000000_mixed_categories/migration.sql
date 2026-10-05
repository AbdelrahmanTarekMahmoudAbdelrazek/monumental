-- Mixed mode: new catalogue categories
ALTER TYPE "MonumentCategory" ADD VALUE IF NOT EXISTS 'animal';
ALTER TYPE "MonumentCategory" ADD VALUE IF NOT EXISTS 'nature';
ALTER TYPE "MonumentCategory" ADD VALUE IF NOT EXISTS 'vehicle';
ALTER TYPE "MonumentCategory" ADD VALUE IF NOT EXISTS 'space';
