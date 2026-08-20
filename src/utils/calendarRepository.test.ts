/**
 * calendarRepository.test.ts
 * Tests for calendar repository
 */

import type { Calendar, CalendarEvent } from '../types/index.js';
import { calendarRepository } from './calendarRepository.js';
import { executeCli } from './cliExecutor.js';

// Mock dependencies
jest.mock('./cliExecutor.js');

const mockExecuteCli = executeCli as jest.MockedFunction<typeof executeCli>;

describe('CalendarRepository', () => {
  const repository = calendarRepository;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findEventById', () => {
    it('should return event when found', async () => {
      const mockEvents: Partial<CalendarEvent>[] = [
        {
          id: '1',
          title: 'Meeting',
          startDate: '2025-11-04T09:00:00+08:00',
          endDate: '2025-11-04T10:00:00+08:00',
          calendar: 'Work',
          isAllDay: false,
        },
        {
          id: '2',
          title: 'Lunch',
          startDate: '2025-11-04T12:00:00+08:00',
          endDate: '2025-11-04T13:00:00+08:00',
          calendar: 'Personal',
          isAllDay: false,
        },
      ];

      mockExecuteCli.mockResolvedValue({
        calendars: [],
        events: mockEvents,
      });

      const result = await repository.findEventById('2');

      // findEventById now bounds to ±2 years (fixes #73)
      const callArgs = mockExecuteCli.mock.calls[0][0] as string[];
      expect(callArgs.slice(0, 2)).toEqual(['--action', 'read-events']);
      expect(callArgs).toContain('--startDate');
      expect(callArgs).toContain('--endDate');

      expect(result).toEqual({
        id: '2',
        title: 'Lunch',
        startDate: '2025-11-04T12:00:00+08:00',
        endDate: '2025-11-04T13:00:00+08:00',
        calendar: 'Personal',
        isAllDay: false,
        notes: undefined,
        location: undefined,
        url: undefined,
      });
    });

    it('should convert null latitude/longitude to undefined for an ungeocoded location', async () => {
      const mockEvents: Partial<CalendarEvent>[] = [
        {
          id: '3',
          title: 'Ungeocoded Event',
          startDate: '2025-11-04T09:00:00+08:00',
          endDate: '2025-11-04T10:00:00+08:00',
          calendar: 'Work',
          isAllDay: false,
          location: 'a total nonsense place 12345',
          // @ts-expect-error simulating raw CLI JSON where geocoding missed
          latitude: null,
          // @ts-expect-error simulating raw CLI JSON where geocoding missed
          longitude: null,
        },
      ];

      mockExecuteCli.mockResolvedValue({
        calendars: [],
        events: mockEvents,
      });

      const result = await repository.findEventById('3');

      expect(result.latitude).toBeUndefined();
      expect(result.longitude).toBeUndefined();
      expect(result.location).toBe('a total nonsense place 12345');
    });

    it('should surface latitude/longitude for a geocoded location', async () => {
      const mockEvents: Partial<CalendarEvent>[] = [
        {
          id: '4',
          title: 'Geocoded Event',
          startDate: '2025-11-04T09:00:00+08:00',
          endDate: '2025-11-04T10:00:00+08:00',
          calendar: 'Work',
          isAllDay: false,
          location: 'Sofitel Warsaw Victoria, Królewska 11, Warszawa',
          latitude: 52.2419,
          longitude: 21.0138,
        },
      ];

      mockExecuteCli.mockResolvedValue({
        calendars: [],
        events: mockEvents,
      });

      const result = await repository.findEventById('4');

      expect(result.latitude).toBe(52.2419);
      expect(result.longitude).toBe(21.0138);
    });

    it('should throw error when event not found', async () => {
      const mockEvents: Partial<CalendarEvent>[] = [
        {
          id: '1',
          title: 'Meeting',
          startDate: '2025-11-04T09:00:00+08:00',
          endDate: '2025-11-04T10:00:00+08:00',
          calendar: 'Work',
          isAllDay: false,
        },
      ];

      mockExecuteCli.mockResolvedValue({
        calendars: [],
        events: mockEvents,
      });

      await expect(repository.findEventById('999')).rejects.toThrow(
        "Event with ID '999' not found.",
      );
    });
  });

  describe('findEvents', () => {
    it('should return all events when no filters provided (with default ±2yr bounds)', async () => {
      const mockEvents: Partial<CalendarEvent>[] = [
        {
          id: '1',
          title: 'Event 1',
          startDate: '2025-11-04T09:00:00+08:00',
          endDate: '2025-11-04T10:00:00+08:00',
          calendar: 'Work',
          isAllDay: false,
        },
      ];

      mockExecuteCli.mockResolvedValue({
        calendars: [],
        events: mockEvents,
      });

      const result = await repository.findEvents();

      // findEvents now defaults to ±2 years (EventKit returns 0 for unbounded)
      const callArgs = mockExecuteCli.mock.calls[0][0] as string[];
      expect(callArgs.slice(0, 2)).toEqual(['--action', 'read-events']);
      expect(callArgs).toContain('--startDate');
      expect(callArgs).toContain('--endDate');
      expect(result).toHaveLength(1);
    });

    it('should filter events by calendar name', async () => {
      const mockEvents: Partial<CalendarEvent>[] = [
        {
          id: '1',
          title: 'Work Event',
          startDate: '2025-11-04T09:00:00+08:00',
          endDate: '2025-11-04T10:00:00+08:00',
          calendar: 'Work',
          isAllDay: false,
        },
      ];

      mockExecuteCli.mockResolvedValue({
        calendars: [],
        events: mockEvents,
      });

      await repository.findEvents({ calendarName: 'Work' });

      const callArgs = mockExecuteCli.mock.calls[0][0] as string[];
      expect(callArgs).toContain('--action');
      expect(callArgs).toContain('read-events');
      expect(callArgs).toContain('--filterCalendar');
      expect(callArgs).toContain('Work');
      // Default date bounds always present
      expect(callArgs).toContain('--startDate');
      expect(callArgs).toContain('--endDate');
    });

    it('should filter events by date range', async () => {
      mockExecuteCli.mockResolvedValue({
        calendars: [],
        events: [],
      });

      await repository.findEvents({
        startDate: '2025-11-04 00:00:00',
        endDate: '2025-11-05 23:59:59',
      });

      expect(mockExecuteCli).toHaveBeenCalledWith([
        '--action',
        'read-events',
        '--startDate',
        '2025-11-04 00:00:00',
        '--endDate',
        '2025-11-05 23:59:59',
      ]);
    });

    it('should filter events by search term', async () => {
      mockExecuteCli.mockResolvedValue({
        calendars: [],
        events: [],
      });

      await repository.findEvents({ search: 'meeting' });

      const callArgs = mockExecuteCli.mock.calls[0][0] as string[];
      expect(callArgs).toContain('--action');
      expect(callArgs).toContain('read-events');
      expect(callArgs).toContain('--search');
      expect(callArgs).toContain('meeting');
      // Default date bounds always present
      expect(callArgs).toContain('--startDate');
      expect(callArgs).toContain('--endDate');
    });
  });

  describe('findAllCalendars', () => {
    it('should return all calendars', async () => {
      const mockCalendars: Calendar[] = [
        { id: '1', title: 'Work' },
        { id: '2', title: 'Personal' },
      ];

      mockExecuteCli.mockResolvedValue(mockCalendars);

      const result = await repository.findAllCalendars();

      expect(mockExecuteCli).toHaveBeenCalledWith([
        '--action',
        'read-calendars',
      ]);
      expect(result).toEqual(mockCalendars);
    });
  });

  describe('createEvent', () => {
    it('should create event with all fields', async () => {
      const mockEvent: CalendarEvent = {
        id: 'new-1',
        title: 'New Event',
        startDate: '2025-11-04T14:00:00+08:00',
        endDate: '2025-11-04T16:00:00+08:00',
        calendar: 'Work',
        notes: 'Some notes',
        location: 'Office',
        url: 'https://example.com',
        isAllDay: false,
      };

      mockExecuteCli.mockResolvedValue(mockEvent);

      const result = await repository.createEvent({
        title: 'New Event',
        startDate: '2025-11-04 14:00:00',
        endDate: '2025-11-04 16:00:00',
        calendar: 'Work',
        notes: 'Some notes',
        location: 'Office',
        url: 'https://example.com',
        isAllDay: false,
      });

      expect(mockExecuteCli).toHaveBeenCalledWith([
        '--action',
        'create-event',
        '--title',
        'New Event',
        '--startDate',
        '2025-11-04 14:00:00',
        '--endDate',
        '2025-11-04 16:00:00',
        '--targetCalendar',
        'Work',
        '--note',
        'Some notes',
        '--location',
        'Office',
        '--url',
        'https://example.com',
        '--isAllDay',
        'false',
      ]);
      expect(result).toEqual(mockEvent);
    });

    it('should create event with minimal fields', async () => {
      const mockEvent: CalendarEvent = {
        id: 'new-2',
        title: 'Simple Event',
        startDate: '2025-11-04T10:00:00+08:00',
        endDate: '2025-11-04T11:00:00+08:00',
        calendar: 'Personal',
        isAllDay: false,
      };

      mockExecuteCli.mockResolvedValue(mockEvent);

      const result = await repository.createEvent({
        title: 'Simple Event',
        startDate: '2025-11-04 10:00:00',
        endDate: '2025-11-04 11:00:00',
      });

      expect(mockExecuteCli).toHaveBeenCalledWith([
        '--action',
        'create-event',
        '--title',
        'Simple Event',
        '--startDate',
        '2025-11-04 10:00:00',
        '--endDate',
        '2025-11-04 11:00:00',
      ]);
      expect(result).toEqual(mockEvent);
    });

    it('should create all-day event', async () => {
      const mockEvent: CalendarEvent = {
        id: 'new-3',
        title: 'All Day Event',
        startDate: '2025-11-04T00:00:00+08:00',
        endDate: '2025-11-04T23:59:59+08:00',
        calendar: 'Personal',
        isAllDay: true,
      };

      mockExecuteCli.mockResolvedValue(mockEvent);

      await repository.createEvent({
        title: 'All Day Event',
        startDate: '2025-11-04 00:00:00',
        endDate: '2025-11-04 23:59:59',
        isAllDay: true,
      });

      expect(mockExecuteCli).toHaveBeenCalledWith(
        expect.arrayContaining(['--isAllDay', 'true']),
      );
    });

    it('should create event with recurrence parameters', async () => {
      mockExecuteCli.mockResolvedValue({
        id: 'recurring-1',
        title: 'Weekly Meeting',
        startDate: '2025-11-04T10:00:00+08:00',
        endDate: '2025-11-04T11:00:00+08:00',
        calendar: 'Work',
        isAllDay: false,
      });

      await repository.createEvent({
        title: 'Weekly Meeting',
        startDate: '2025-11-04 10:00:00',
        endDate: '2025-11-04 11:00:00',
        recurrence: {
          frequency: 'weekly',
          interval: 2,
          endDate: '2025-12-31',
          occurrenceCount: 10,
        },
      });

      expect(mockExecuteCli).toHaveBeenCalledWith(
        expect.arrayContaining([
          '--recurrence',
          'weekly',
          '--recurrenceInterval',
          '2',
          '--recurrenceEnd',
          '2025-12-31',
          '--recurrenceCount',
          '10',
        ]),
      );
    });

    it('should create event without recurrence when not specified', async () => {
      mockExecuteCli.mockResolvedValue({
        id: 'no-rec',
        title: 'Single Event',
        startDate: '2025-11-04T10:00:00+08:00',
        endDate: '2025-11-04T11:00:00+08:00',
        calendar: 'Work',
        isAllDay: false,
      });

      await repository.createEvent({
        title: 'Single Event',
        startDate: '2025-11-04 10:00:00',
        endDate: '2025-11-04 11:00:00',
      });

      const callArgs = mockExecuteCli.mock.calls[0][0] as string[];
      expect(callArgs).not.toContain('--recurrence');
      expect(callArgs).not.toContain('--recurrenceInterval');
      expect(callArgs).not.toContain('--recurrenceEnd');
      expect(callArgs).not.toContain('--recurrenceCount');
    });

    it('should not pass --geocode/--latitude/--longitude when not specified', async () => {
      mockExecuteCli.mockResolvedValue({
        id: 'no-geo',
        title: 'Plain Event',
        startDate: '2025-11-04T10:00:00+08:00',
        endDate: '2025-11-04T11:00:00+08:00',
        calendar: 'Work',
        isAllDay: false,
      });

      await repository.createEvent({
        title: 'Plain Event',
        startDate: '2025-11-04 10:00:00',
        endDate: '2025-11-04 11:00:00',
        location: 'Some Cafe',
      });

      const callArgs = mockExecuteCli.mock.calls[0][0] as string[];
      expect(callArgs).not.toContain('--geocode');
      expect(callArgs).not.toContain('--latitude');
      expect(callArgs).not.toContain('--longitude');
    });

    it('should pass geocode=false to disable geocoding', async () => {
      mockExecuteCli.mockResolvedValue({
        id: 'flat-loc',
        title: 'Flat Location Event',
        startDate: '2025-11-04T10:00:00+08:00',
        endDate: '2025-11-04T11:00:00+08:00',
        calendar: 'Work',
        isAllDay: false,
      });

      await repository.createEvent({
        title: 'Flat Location Event',
        startDate: '2025-11-04 10:00:00',
        endDate: '2025-11-04 11:00:00',
        location: 'Somewhere',
        geocode: false,
      });

      expect(mockExecuteCli).toHaveBeenCalledWith(
        expect.arrayContaining(['--geocode', 'false']),
      );
    });

    it('should pass explicit latitude/longitude to bypass the geocoder', async () => {
      mockExecuteCli.mockResolvedValue({
        id: 'explicit-geo',
        title: 'Explicit Coords Event',
        startDate: '2025-11-04T10:00:00+08:00',
        endDate: '2025-11-04T11:00:00+08:00',
        calendar: 'Work',
        isAllDay: false,
      });

      await repository.createEvent({
        title: 'Explicit Coords Event',
        startDate: '2025-11-04 10:00:00',
        endDate: '2025-11-04 11:00:00',
        location: 'Sofitel Warsaw Victoria',
        latitude: 52.2419,
        longitude: 21.0138,
      });

      expect(mockExecuteCli).toHaveBeenCalledWith(
        expect.arrayContaining([
          '--latitude',
          '52.2419',
          '--longitude',
          '21.0138',
        ]),
      );
    });
  });

  describe('updateEvent', () => {
    it('should update event with provided fields', async () => {
      const mockEvent: CalendarEvent = {
        id: '1',
        title: 'Updated Event',
        startDate: '2025-11-04T15:00:00+08:00',
        endDate: '2025-11-04T17:00:00+08:00',
        calendar: 'Work',
        isAllDay: false,
      };

      mockExecuteCli.mockResolvedValue(mockEvent);

      const result = await repository.updateEvent({
        id: '1',
        title: 'Updated Event',
        startDate: '2025-11-04 15:00:00',
        endDate: '2025-11-04 17:00:00',
      });

      expect(mockExecuteCli).toHaveBeenCalledWith([
        '--action',
        'update-event',
        '--id',
        '1',
        '--title',
        'Updated Event',
        '--startDate',
        '2025-11-04 15:00:00',
        '--endDate',
        '2025-11-04 17:00:00',
      ]);
      expect(result).toEqual(mockEvent);
    });

    it('should update event calendar', async () => {
      mockExecuteCli.mockResolvedValue({
        id: '1',
        title: 'Event',
        startDate: '2025-11-04T09:00:00+08:00',
        endDate: '2025-11-04T10:00:00+08:00',
        calendar: 'Personal',
        isAllDay: false,
      });

      await repository.updateEvent({
        id: '1',
        calendar: 'Personal',
      });

      expect(mockExecuteCli).toHaveBeenCalledWith(
        expect.arrayContaining(['--targetCalendar', 'Personal']),
      );
    });

    it('should update event with recurrence parameters', async () => {
      mockExecuteCli.mockResolvedValue({
        id: '1',
        title: 'Updated',
        startDate: '2025-11-04T09:00:00+08:00',
        endDate: '2025-11-04T10:00:00+08:00',
        calendar: 'Work',
        isAllDay: false,
      });

      await repository.updateEvent({
        id: '1',
        recurrence: { frequency: 'daily', interval: 1 },
      });

      expect(mockExecuteCli).toHaveBeenCalledWith(
        expect.arrayContaining([
          '--recurrence',
          'daily',
          '--recurrenceInterval',
          '1',
        ]),
      );
    });

    it('should update event without recurrence when not specified', async () => {
      mockExecuteCli.mockResolvedValue({
        id: '1',
        title: 'Simple',
        startDate: '2025-11-04T09:00:00+08:00',
        endDate: '2025-11-04T10:00:00+08:00',
        calendar: 'Work',
        isAllDay: false,
      });

      await repository.updateEvent({ id: '1', title: 'Simple' });

      const callArgs = mockExecuteCli.mock.calls[0][0] as string[];
      expect(callArgs).not.toContain('--recurrence');
    });

    it('should update event location with re-geocoding by default', async () => {
      mockExecuteCli.mockResolvedValue({
        id: '1',
        title: 'Moved Meeting',
        startDate: '2025-11-04T09:00:00+08:00',
        endDate: '2025-11-04T10:00:00+08:00',
        calendar: 'Work',
        isAllDay: false,
      });

      await repository.updateEvent({
        id: '1',
        location: 'Sofitel Warsaw Victoria',
      });

      const callArgs = mockExecuteCli.mock.calls[0][0] as string[];
      expect(callArgs).toContain('--location');
      expect(callArgs).not.toContain('--geocode');
    });

    it('should pass geocode=false when updating location without geocoding', async () => {
      mockExecuteCli.mockResolvedValue({
        id: '1',
        title: 'Moved Meeting',
        startDate: '2025-11-04T09:00:00+08:00',
        endDate: '2025-11-04T10:00:00+08:00',
        calendar: 'Work',
        isAllDay: false,
      });

      await repository.updateEvent({
        id: '1',
        location: 'Somewhere else',
        geocode: false,
      });

      expect(mockExecuteCli).toHaveBeenCalledWith(
        expect.arrayContaining(['--geocode', 'false']),
      );
    });
  });

  describe('deleteEvent', () => {
    it('should delete event by id', async () => {
      mockExecuteCli.mockResolvedValue({});

      await repository.deleteEvent('1');

      expect(mockExecuteCli).toHaveBeenCalledWith([
        '--action',
        'delete-event',
        '--id',
        '1',
      ]);
    });
  });
});
