import { Test, TestingModule } from '@nestjs/testing';
import { EpicorService } from './epicor.service';

describe('EpicorService', () => {
  let service: EpicorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EpicorService],
    }).compile();

    service = module.get<EpicorService>(EpicorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
