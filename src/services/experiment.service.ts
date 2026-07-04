import { ExperimentRepository } from '../repositories/experiment.repository';
import { logger } from '../utils/logger';
import type {
  Experiment,
  ExperimentVariant,
  ExperimentAssignment,
  ExperimentStatus,
} from '../types';
import type {
  CreateExperimentInput,
  ExperimentResult,
  ExperimentAnalysis,
  StatisticalTestResult,
  EndExperimentInput,
} from '../types/analytics.types';

/**
 * ExperimentService
 * Manages A/B testing experiments for the analytics system
 */
export class ExperimentService {
  constructor(private experimentRepo: ExperimentRepository) {}

  /**
   * Create a new experiment with variants
   */
  async createExperiment(input: CreateExperimentInput): Promise<{
    experiment: Experiment;
    variants: ExperimentVariant[];
  }> {
    // Validate weights sum to 100
    const totalWeight = input.variants.reduce((sum, v) => sum + v.weight, 0);
    if (totalWeight !== 100) {
      throw new Error(`Variant weights must sum to 100, got ${totalWeight}`);
    }

    // Validate variant names are unique
    const variantNames = input.variants.map((v) => v.name);
    const uniqueNames = new Set(variantNames);
    if (variantNames.length !== uniqueNames.size) {
      throw new Error('Variant names must be unique');
    }

    // Create experiment
    const experiment = await this.experimentRepo.createExperiment({
      name: input.name,
      description: input.description || null,
      targetMetric: input.targetMetric,
      status: 'draft',
      config: input.config ? JSON.stringify(input.config) : null,
      startDate: input.startDate || null,
      endDate: input.endDate || null,
    });

    // Create variants
    const variants = await this.experimentRepo.createVariants(
      input.variants.map((v) => ({
        experimentId: experiment.id,
        name: v.name,
        weight: v.weight,
        config: v.config ? JSON.stringify(v.config) : null,
      }))
    );

    logger.info('[Experiment] Created experiment', {
      experimentId: experiment.id,
      name: experiment.name,
      variantCount: variants.length,
    });

    return { experiment, variants };
  }

  /**
   * Get variant assignment for a user
   * If not assigned, assigns user to a variant based on weights
   */
  async getVariantForUser(
    experimentId: string,
    senderId: string
  ): Promise<{
    assignment: ExperimentAssignment;
    variant: ExperimentVariant;
  }> {
    // Check if experiment is active
    const experiment = await this.experimentRepo.getExperiment(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    if (experiment.status !== 'running') {
      throw new Error(
        `Experiment ${experimentId} is not running (status: ${experiment.status})`
      );
    }

    // Get or create assignment
    const assignment = await this.experimentRepo.assignUser(experimentId, senderId);
    const variant = await this.experimentRepo.getVariant(assignment.variantId);

    if (!variant) {
      throw new Error(`Variant ${assignment.variantId} not found`);
    }

    logger.debug('[Experiment] User assigned to variant', {
      experimentId,
      senderId,
      variantId: variant.id,
      variantName: variant.name,
    });

    return { assignment, variant };
  }

  /**
   * Record a conversion event for a user in an experiment
   */
  async recordConversion(
    experimentId: string,
    senderId: string,
    value?: number
  ): Promise<void> {
    // Get user's assignment
    const assignment = await this.experimentRepo.getUserAssignment(experimentId, senderId);
    if (!assignment) {
      throw new Error(`User ${senderId} not assigned to experiment ${experimentId}`);
    }

    // Record conversion event
    await this.experimentRepo.recordEvent({
      experimentId,
      variantId: assignment.variantId,
      senderId,
      eventType: 'conversion',
      value: value || null,
      metadata: null,
    });

    logger.debug('[Experiment] Recorded conversion', {
      experimentId,
      senderId,
      variantId: assignment.variantId,
      value,
    });
  }

  /**
   * Record a metric value event for a user in an experiment
   */
  async recordMetricValue(
    experimentId: string,
    senderId: string,
    metricValue: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    // Get user's assignment
    const assignment = await this.experimentRepo.getUserAssignment(experimentId, senderId);
    if (!assignment) {
      throw new Error(`User ${senderId} not assigned to experiment ${experimentId}`);
    }

    // Record metric event
    await this.experimentRepo.recordEvent({
      experimentId,
      variantId: assignment.variantId,
      senderId,
      eventType: 'metric_value',
      value: metricValue,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    logger.debug('[Experiment] Recorded metric value', {
      experimentId,
      senderId,
      variantId: assignment.variantId,
      metricValue,
    });
  }

  /**
   * Get experiment results with statistical analysis
   */
  async getResults(experimentId: string): Promise<ExperimentAnalysis> {
    const experiment = await this.experimentRepo.getExperiment(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    // Get raw results
    const results = await this.experimentRepo.getExperimentResults(experimentId);

    // Calculate statistical significance between variants
    if (results.length >= 2) {
      // Use first variant (usually 'control') as baseline
      const baseline = results[0];

      for (let i = 1; i < results.length; i++) {
        const variant = results[i];
        const testResult = this.calculateChiSquareTest(
          baseline.sampleSize,
          baseline.conversionCount,
          variant.sampleSize,
          variant.conversionCount
        );

        results[i].statisticalSignificance = testResult.pValue;
      }
    }

    // Determine winning variant (highest conversion rate with statistical significance)
    let winningVariant: ExperimentResult | null = null;
    if (results.length > 0) {
      // Sort by conversion rate descending
      const sortedResults = [...results].sort((a, b) => b.conversionRate - a.conversionRate);
      const topVariant = sortedResults[0];

      // Check if the top variant is statistically significant
      if (
        topVariant.statisticalSignificance !== null &&
        topVariant.statisticalSignificance < 0.05
      ) {
        topVariant.isWinner = true;
        winningVariant = topVariant;
      }
    }

    // Calculate overall statistics
    const totalSampleSize = results.reduce((sum, r) => sum + r.sampleSize, 0);
    const totalConversions = results.reduce((sum, r) => sum + r.conversionCount, 0);
    const avgConversionRate =
      totalSampleSize > 0 ? (totalConversions / totalSampleSize) * 100 : 0;

    // Calculate duration
    let duration: number | null = null;
    if (experiment.startDate && experiment.endDate) {
      duration = experiment.endDate.getTime() - experiment.startDate.getTime();
    } else if (experiment.startDate) {
      duration = Date.now() - experiment.startDate.getTime();
    }

    return {
      experimentId: experiment.id,
      experimentName: experiment.name,
      status: experiment.status,
      targetMetric: experiment.targetMetric,
      startDate: experiment.startDate,
      endDate: experiment.endDate,
      duration,
      results,
      winningVariant,
      overallStatistics: {
        totalSampleSize,
        totalConversions,
        avgConversionRate,
      },
    };
  }

  /**
   * Start an experiment (change status to 'running')
   */
  async startExperiment(experimentId: string): Promise<Experiment> {
    const experiment = await this.experimentRepo.getExperiment(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    if (experiment.status !== 'draft' && experiment.status !== 'paused') {
      throw new Error(
        `Cannot start experiment with status ${experiment.status}. Must be 'draft' or 'paused'.`
      );
    }

    // Validate variants exist
    const variants = await this.experimentRepo.getVariants(experimentId);
    if (variants.length === 0) {
      throw new Error(`Experiment ${experimentId} has no variants`);
    }

    // Update status and set start date if not already set
    const updated = await this.experimentRepo.updateExperiment(experimentId, {
      status: 'running',
      startDate: experiment.startDate || new Date(),
    });

    logger.info('[Experiment] Started experiment', {
      experimentId,
      name: experiment.name,
    });

    return updated;
  }

  /**
   * Pause an experiment
   */
  async pauseExperiment(experimentId: string): Promise<Experiment> {
    const updated = await this.experimentRepo.updateExperimentStatus(experimentId, 'paused');

    logger.info('[Experiment] Paused experiment', {
      experimentId,
    });

    return updated;
  }

  /**
   * End an experiment and optionally declare a winner
   */
  async endExperiment(input: EndExperimentInput): Promise<ExperimentAnalysis> {
    const { experimentId, winningVariantId, reason } = input;

    const experiment = await this.experimentRepo.getExperiment(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    // Update status and end date
    await this.experimentRepo.updateExperiment(experimentId, {
      status: 'completed',
      endDate: new Date(),
    });

    // Get results
    const analysis = await this.getResults(experimentId);

    logger.info('[Experiment] Ended experiment', {
      experimentId,
      name: experiment.name,
      winningVariantId: winningVariantId || analysis.winningVariant?.variantId,
      reason,
    });

    return analysis;
  }

  /**
   * Delete an experiment
   */
  async deleteExperiment(experimentId: string): Promise<void> {
    await this.experimentRepo.deleteExperiment(experimentId);

    logger.info('[Experiment] Deleted experiment', {
      experimentId,
    });
  }

  /**
   * List all experiments
   */
  async listExperiments(status?: ExperimentStatus): Promise<Experiment[]> {
    return this.experimentRepo.getExperiments(status);
  }

  /**
   * Get experiment details with variants
   */
  async getExperiment(experimentId: string): Promise<{
    experiment: Experiment;
    variants: ExperimentVariant[];
  }> {
    const experiment = await this.experimentRepo.getExperiment(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    const variants = await this.experimentRepo.getVariants(experimentId);

    return { experiment, variants };
  }

  // ============================================================================
  // Statistical Tests
  // ============================================================================

  /**
   * Calculate chi-square test for conversion rate difference
   * Tests whether the difference in conversion rates is statistically significant
   */
  private calculateChiSquareTest(
    n1: number,
    conversions1: number,
    n2: number,
    conversions2: number
  ): StatisticalTestResult {
    // If sample sizes are too small, return non-significant
    if (n1 < 30 || n2 < 30) {
      return {
        pValue: 1.0,
        isSignificant: false,
        confidenceLevel: 95,
        testType: 'chi_square',
      };
    }

    // Calculate observed frequencies
    const nonConversions1 = n1 - conversions1;
    const nonConversions2 = n2 - conversions2;

    // Calculate totals
    const totalConversions = conversions1 + conversions2;
    const totalNonConversions = nonConversions1 + nonConversions2;
    const total = n1 + n2;

    // Calculate expected frequencies
    const expectedConversions1 = (n1 * totalConversions) / total;
    const expectedNonConversions1 = (n1 * totalNonConversions) / total;
    const expectedConversions2 = (n2 * totalConversions) / total;
    const expectedNonConversions2 = (n2 * totalNonConversions) / total;

    // Calculate chi-square statistic
    const chiSquare =
      Math.pow(conversions1 - expectedConversions1, 2) / expectedConversions1 +
      Math.pow(nonConversions1 - expectedNonConversions1, 2) / expectedNonConversions1 +
      Math.pow(conversions2 - expectedConversions2, 2) / expectedConversions2 +
      Math.pow(nonConversions2 - expectedNonConversions2, 2) / expectedNonConversions2;

    // Calculate p-value (approximation for df=1)
    // For more accurate results, should use a chi-square distribution lookup table
    // This is a simplified approximation
    const pValue = this.chiSquareToPValue(chiSquare, 1);

    return {
      pValue,
      isSignificant: pValue < 0.05,
      confidenceLevel: 95,
      testType: 'chi_square',
    };
  }

  /**
   * Calculate statistical significance for metric values using t-test
   * Tests whether the difference in mean values is statistically significant
   */
  calculateTTest(
    sampleSize1: number,
    mean1: number,
    stdDev1: number,
    sampleSize2: number,
    mean2: number,
    stdDev2: number
  ): StatisticalTestResult {
    // If sample sizes are too small, return non-significant
    if (sampleSize1 < 30 || sampleSize2 < 30) {
      return {
        pValue: 1.0,
        isSignificant: false,
        confidenceLevel: 95,
        testType: 't_test',
      };
    }

    // Calculate pooled standard deviation
    const pooledStdDev = Math.sqrt(
      ((sampleSize1 - 1) * Math.pow(stdDev1, 2) +
        (sampleSize2 - 1) * Math.pow(stdDev2, 2)) /
        (sampleSize1 + sampleSize2 - 2)
    );

    // Calculate standard error
    const standardError =
      pooledStdDev * Math.sqrt(1 / sampleSize1 + 1 / sampleSize2);

    // Calculate t-statistic
    const tStat = (mean1 - mean2) / standardError;

    // Calculate degrees of freedom
    const degreesOfFreedom = sampleSize1 + sampleSize2 - 2;

    // Calculate p-value (two-tailed test)
    // This is a simplified approximation
    const pValue = this.tStatToPValue(Math.abs(tStat), degreesOfFreedom);

    return {
      pValue,
      isSignificant: pValue < 0.05,
      confidenceLevel: 95,
      testType: 't_test',
    };
  }

  /**
   * Convert chi-square statistic to p-value (approximation)
   * For df=1 (comparing two proportions)
   */
  private chiSquareToPValue(chiSquare: number, df: number): number {
    if (df !== 1) {
      // For simplicity, only supporting df=1
      return 1.0;
    }

    // Critical values for chi-square with df=1
    // 3.841 = 95% confidence (p=0.05)
    // 6.635 = 99% confidence (p=0.01)
    // 10.828 = 99.9% confidence (p=0.001)

    if (chiSquare < 3.841) return 0.05;
    if (chiSquare < 6.635) return 0.01;
    if (chiSquare < 10.828) return 0.001;
    return 0.0001; // Very significant
  }

  /**
   * Convert t-statistic to p-value (approximation)
   * This is a very simplified approximation
   * For production, should use a proper t-distribution library
   */
  private tStatToPValue(tStat: number, df: number): number {
    // Critical values for large df (>30)
    // 1.96 = 95% confidence (p=0.05)
    // 2.576 = 99% confidence (p=0.01)
    // 3.291 = 99.9% confidence (p=0.001)

    if (tStat < 1.96) return 0.05;
    if (tStat < 2.576) return 0.01;
    if (tStat < 3.291) return 0.001;
    return 0.0001; // Very significant
  }
}
