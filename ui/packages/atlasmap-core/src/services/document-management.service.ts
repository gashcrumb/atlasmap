/*
    Copyright (C) 2017 Red Hat, Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

            http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/
import {
  CollectionType,
  DocumentType,
  InspectionType,
} from '../common/config.types';
import {
  DocumentDefinition,
  NamespaceModel,
} from '../models/document-definition.model';
import { EnumValue, Field } from '../models/field.model';
import {
  ErrorInfo,
  ErrorLevel,
  ErrorScope,
  ErrorType,
} from '../models/error.model';
import { Observable, Subscription } from 'rxjs';

import { CommonUtil } from '../utils/common-util';
import { ConfigModel } from '../models/config.model';
import { Guid } from '../utils';
import { HTTP_STATUS_NO_CONTENT } from '../common/constants';
import ky from 'ky';
import { timeout } from 'rxjs/operators';

export class DocumentManagementService {
  cfg!: ConfigModel;

  private mappingUpdatedSubscription!: Subscription;

  private headers = { 'Content-Type': 'application/json' };

  constructor(private api: typeof ky) {}

  initialize(): void {
    this.mappingUpdatedSubscription =
      this.cfg.mappingService.mappingUpdated$.subscribe(() => {
        for (const d of this.cfg.getAllDocs()) {
          if (d.initialized) {
            d.updateFromMappings(this.cfg.mappings!); // TODO: check this non null operator
          }
        }
      });
  }

  ngOnDestroy() {
    this.mappingUpdatedSubscription.unsubscribe();
  }

  fetchDocument(docDef: DocumentDefinition): Observable<DocumentDefinition> {
    return new Observable<DocumentDefinition>((observer: any) => {
      if (docDef.inspectionResult) {
        const responseJson: any = JSON.parse(docDef.inspectionResult);
        this.parseDocumentResponse(responseJson, docDef);
        observer.next(docDef);
        observer.complete();
        return;
      }

      const payload: any = this.createDocumentFetchRequest(docDef);
      let options: any = { json: payload, headers: this.headers };
      let url: string = this.cfg.initCfg.baseJavaInspectionServiceUrl + 'class';
      if (
        docDef.type === DocumentType.XML ||
        docDef.type === DocumentType.XSD
      ) {
        url = this.cfg.initCfg.baseXMLInspectionServiceUrl + 'inspect';
      } else if (docDef.type === DocumentType.JSON) {
        url = this.cfg.initCfg.baseJSONInspectionServiceUrl + 'inspect';
      } else if (docDef.type === DocumentType.CSV) {
        url = this.cfg.initCfg.baseCSVInspectionServiceUrl + 'inspect';
        options = {
          body: payload,
          headers: this.headers,
          searchParams: docDef.inspectionParameters,
        };
      }

      this.cfg.logger!.debug(
        `Document Service Request: ${JSON.stringify(payload)}`
      );
      this.api
        .post(url, options)
        .json()
        .then((responseJson: any) => {
          this.cfg.logger!.debug(
            `Document Service Response: ${JSON.stringify(responseJson)}`
          );
          this.parseDocumentResponse(responseJson, docDef);
          observer.next(docDef);
          observer.complete();
        })
        .catch((error: any) => {
          observer.error(error);
          docDef.errorOccurred = true;
          observer.next(docDef);
          observer.complete();
        });
    });
  }

  getLibraryClassNames(): Observable<string[]> {
    return new Observable<string[]>((observer: any) => {
      if (typeof this.cfg.initCfg.baseMappingServiceUrl === 'undefined') {
        observer.complete();
        return;
      }
      const url: string =
        this.cfg.initCfg.baseMappingServiceUrl + 'library/list';
      this.cfg.logger!.debug('Library Class List Service Request: ' + url);
      this.api
        .get(url)
        .json()
        .then((body: any) => {
          this.cfg.logger!.debug(
            `Library Class List Service Response: ${JSON.stringify(body)}`
          );
          const classNames: string[] = body.ArrayList;
          observer.next(classNames);
          observer.complete();
        })
        .catch((error: any) => {
          if (error.status !== HTTP_STATUS_NO_CONTENT) {
            this.handleError(
              'Error occurred while accessing the user uploaded JARs from the runtime service.',
              error
            );
            observer.error(error);
          }
          observer.complete();
        });
    }).pipe(timeout(this.cfg.initCfg.admHttpTimeout));
  }

  /**
   * Read the selected file and parse it with the format defined by the specified inspection type.  Call the
   * initialization service to update the sources/ targets in both the runtime and the UI.  The runtime will
   * parse/ validate the file.
   *
   * @param selectedFile - user selected file
   * @param inspectionType - document format
   * @param isSource - true is source panel, false is target
   * @param isSchema- user specified instance/ schema (true === schema)
   * @param inspectionParameters - CSV parameters

   */
  async processDocument(
    selectedFile: any,
    inspectionType: InspectionType,
    isSource: boolean,
    isSchema: boolean,
    inspectionParameters?: { [key: string]: string }
  ): Promise<boolean> {
    return new Promise<boolean>(async (resolve) => {
      let fileBin = null;
      let fileText = '';
      const reader = new FileReader();

      this.cfg.errorService.clearValidationErrors();

      const userFileComps = selectedFile.name.split('.');
      const userFile = userFileComps.slice(0, -1).join('.');
      const userFileSuffix: string =
        userFileComps[userFileComps.length - 1].toUpperCase();

      if (userFileSuffix !== DocumentType.JAVA_ARCHIVE) {
        // Wait for the async read of the selected ascii document to be completed.
        try {
          fileText = await CommonUtil.readFile(selectedFile, reader);
        } catch (error) {
          this.cfg.errorService.addError(
            new ErrorInfo({
              message: 'Unable to import the specified schema document.',
              level: ErrorLevel.ERROR,
              scope: ErrorScope.APPLICATION,
              type: ErrorType.USER,
              object: error,
            })
          );
          resolve(false);
          return;
        }
      }

      switch (userFileSuffix) {
        case DocumentType.JSON:
          inspectionType = isSchema
            ? InspectionType.SCHEMA
            : InspectionType.INSTANCE;
          await this.cfg.initializationService.initializeUserDoc(
            fileText,
            userFile + '-' + Guid.newGuid(),
            userFile,
            DocumentType.JSON,
            inspectionType,
            isSource
          );
          break;

        case DocumentType.JAVA_ARCHIVE:
          // Wait for the async read of the selected binary document to be completed.
          try {
            fileBin = await CommonUtil.readBinaryFile(selectedFile, reader);
          } catch (error) {
            this.cfg.errorService.addError(
              new ErrorInfo({
                message: 'Unable to import the specified schema document.',
                level: ErrorLevel.ERROR,
                scope: ErrorScope.APPLICATION,
                type: ErrorType.USER,
                object: error,
              })
            );
            resolve(false);
            return;
          }
          if (inspectionType === InspectionType.UNKNOWN) {
            inspectionType = InspectionType.JAVA_CLASS;
          }
          await this.cfg.initializationService.initializeUserDoc(
            fileBin,
            userFile,
            userFile,
            DocumentType.JAVA_ARCHIVE,
            inspectionType,
            isSource
          );
          this.cfg.errorService.addError(
            new ErrorInfo({
              message: `${selectedFile.name} import complete.  Select the circle-plus icon on the Source/Target panel to enable specific classes.`,
              level: ErrorLevel.INFO,
              scope: ErrorScope.APPLICATION,
              type: ErrorType.USER,
            })
          );
          resolve(true);
          return;

        case 'java':
          await this.cfg.initializationService.initializeUserDoc(
            fileText,
            userFile,
            userFile,
            DocumentType.JAVA,
            inspectionType,
            isSource
          );
          break;

        case DocumentType.CSV:
          await this.cfg.initializationService.initializeUserDoc(
            fileText,
            userFile + '-' + Guid.newGuid(),
            userFile,
            DocumentType.CSV,
            inspectionType,
            isSource,
            inspectionParameters
          );
          break;

        case DocumentType.XML:
        case DocumentType.XSD:
          inspectionType = isSchema
            ? InspectionType.SCHEMA
            : InspectionType.INSTANCE;
          await this.cfg.initializationService.initializeUserDoc(
            fileText,
            userFile + '-' + Guid.newGuid(),
            userFile,
            userFileSuffix,
            inspectionType,
            isSource
          );
          break;

        default:
          this.handleError(
            'Unrecognized document suffix (' + userFileSuffix + ')',
            null
          );
      }

      this.cfg.errorService.addError(
        new ErrorInfo({
          message: `${selectedFile.name} ${userFileSuffix} import complete.`,
          level: ErrorLevel.INFO,
          scope: ErrorScope.APPLICATION,
          type: ErrorType.USER,
        })
      );
      resolve(true);
    });
  }

  private createDocumentFetchRequest(docDef: DocumentDefinition): any {
    if (docDef.type === DocumentType.XML || docDef.type === DocumentType.XSD) {
      return {
        XmlInspectionRequest: {
          jsonType: 'io.atlasmap.xml.v2.XmlInspectionRequest',
          type: docDef.inspectionType,
          xmlData: docDef.inspectionSource,
        },
      };
    }
    if (docDef.type === DocumentType.JSON) {
      return {
        JsonInspectionRequest: {
          jsonType: 'io.atlasmap.json.v2.JsonInspectionRequest',
          type: docDef.inspectionType,
          jsonData: docDef.inspectionSource,
        },
      };
    }
    if (docDef.type === DocumentType.CSV) {
      return docDef.inspectionSource;
    }
    const className: string = docDef.inspectionSource;
    const payload: any = {
      ClassInspectionRequest: {
        jsonType:
          ConfigModel.javaServicesPackagePrefix + '.ClassInspectionRequest',
        className: className,
        disablePrivateOnlyFields: this.cfg.initCfg.disablePrivateOnlyFields,
        disableProtectedOnlyFields: this.cfg.initCfg.disableProtectedOnlyFields,
        disablePublicOnlyFields: this.cfg.initCfg.disablePublicOnlyFields,
        disablePublicGetterSetterFields:
          this.cfg.initCfg.disablePublicGetterSetterFields,
      },
    };
    if (
      docDef.initModel.collectionType &&
      (docDef.initModel.collectionType as CollectionType) !==
        CollectionType.NONE
    ) {
      payload['ClassInspectionRequest']['collectionType'] =
        docDef.initModel.collectionType;
      if (docDef.initModel.collectionClassName) {
        payload['ClassInspectionRequest']['collectionClassName'] =
          docDef.initModel.collectionClassName;
      }
    }
    if (
      this.cfg.initCfg.fieldNameExclusions &&
      this.cfg.initCfg.fieldNameExclusions.length
    ) {
      payload['ClassInspectionRequest']['fieldNameExclusions'] = {
        string: this.cfg.initCfg.fieldNameExclusions,
      };
    }
    if (
      this.cfg.initCfg.classNameExclusions &&
      this.cfg.initCfg.classNameExclusions.length
    ) {
      payload['ClassInspectionRequest']['classNameExclusions'] = {
        string: this.cfg.initCfg.classNameExclusions,
      };
    }
    return payload;
  }

  parseDocumentResponse(responseJson: any, docDef: DocumentDefinition): void {
    if (docDef.type === DocumentType.JAVA) {
      if (typeof responseJson.ClassInspectionResponse !== 'undefined') {
        this.extractJavaDocumentDefinitionFromInspectionResponse(
          responseJson,
          docDef
        );
      } else if (
        typeof responseJson.javaClass !== 'undefined' ||
        typeof responseJson.JavaClass !== 'undefined'
      ) {
        this.extractJavaDocumentDefinition(responseJson, docDef);
      } else {
        this.handleError('Unknown Java inspection result format', responseJson);
      }
    } else if (docDef.type === DocumentType.JSON) {
      if (typeof responseJson.JsonInspectionResponse !== 'undefined') {
        this.extractJSONDocumentDefinitionFromInspectionResponse(
          responseJson,
          docDef
        );
      } else if (
        typeof responseJson.jsonDocument !== 'undefined' ||
        typeof responseJson.JsonDocument !== 'undefined'
      ) {
        this.extractJSONDocumentDefinition(responseJson, docDef);
      } else {
        this.handleError('Unknown JSON inspection result format', responseJson);
      }
    } else if (docDef.type === DocumentType.CSV) {
      if (typeof responseJson.CsvInspectionResponse !== 'undefined') {
        this.extractCSVDocumentDefinitionFromInspectionResponse(
          responseJson,
          docDef
        );
      } else if (
        typeof responseJson.csvDocument !== 'undefined' ||
        typeof responseJson.csvDocument !== 'undefined'
      ) {
        this.extractCSVDocumentDefinition(responseJson, docDef);
      } else {
        this.handleError('Unknown CSV inspection result format', responseJson);
      }
    } else {
      if (typeof responseJson.XmlInspectionResponse !== 'undefined') {
        this.extractXMLDocumentDefinitionFromInspectionResponse(
          responseJson,
          docDef
        );
      } else if (
        typeof responseJson.xmlDocument !== 'undefined' ||
        typeof responseJson.XmlDocument !== 'undefined'
      ) {
        this.extractXMLDocumentDefinition(responseJson, docDef);
      } else {
        this.handleError('Unknown XML inspection result format', responseJson);
      }
    }
    docDef.initializeFromFields();
  }

  private extractCSVDocumentDefinitionFromInspectionResponse(
    responseJson: any,
    docDef: DocumentDefinition
  ): void {
    const body: any = responseJson.CsvInspectionResponse;
    if (body.errorMessage) {
      this.handleError(
        'Could not load JSON document, error: ' + body.errorMessage,
        null
      );
      docDef.errorOccurred = true;
      return;
    }

    this.extractCSVDocumentDefinition(body, docDef);
  }

  private extractCSVDocumentDefinition(
    body: any,
    docDef: DocumentDefinition
  ): void {
    let csvDocument: any;
    if (typeof body.csvDocument !== 'undefined') {
      csvDocument = body.csvDocument;
    } else {
      csvDocument = body.CsvDocument;
    }

    if (!docDef.description) {
      docDef.description = docDef.id;
    }
    if (!docDef.name) {
      docDef.name = docDef.id;
    }

    docDef.characterEncoding = csvDocument.characterEncoding;
    docDef.locale = csvDocument.locale;

    for (const field of csvDocument.fields.field) {
      this.parseCSVFieldFromDocument(field, null, docDef);
    }
  }

  private extractJSONDocumentDefinitionFromInspectionResponse(
    responseJson: any,
    docDef: DocumentDefinition
  ): void {
    const body: any = responseJson.JsonInspectionResponse;
    if (body.errorMessage) {
      this.handleError(
        'Could not load JSON document, error: ' + body.errorMessage,
        null
      );
      docDef.errorOccurred = true;
      return;
    }

    this.extractJSONDocumentDefinition(body, docDef);
  }

  private extractJSONDocumentDefinition(
    body: any,
    docDef: DocumentDefinition
  ): void {
    let jsonDocument: any;
    if (typeof body.jsonDocument !== 'undefined') {
      jsonDocument = body.jsonDocument;
    } else {
      jsonDocument = body.JsonDocument;
    }

    if (!docDef.description) {
      docDef.description = docDef.id;
    }
    if (!docDef.name) {
      docDef.name = docDef.id;
    }

    docDef.characterEncoding = jsonDocument.characterEncoding;
    docDef.locale = jsonDocument.locale;

    for (const field of jsonDocument.fields.field) {
      this.parseJSONFieldFromDocument(field, null, docDef);
    }
  }

  private extractXMLDocumentDefinitionFromInspectionResponse(
    responseJson: any,
    docDef: DocumentDefinition
  ): void {
    const body: any = responseJson.XmlInspectionResponse;
    if (body.errorMessage) {
      this.handleError(
        'Could not load XML document, error: ' + body.errorMessage,
        null
      );
      docDef.errorOccurred = true;
      return;
    }

    this.extractXMLDocumentDefinition(body, docDef);
  }

  extractXMLDocumentDefinition(body: any, docDef: DocumentDefinition): void {
    let xmlDocument: any;
    if (typeof body.xmlDocument !== 'undefined') {
      xmlDocument = body.xmlDocument;
    } else {
      xmlDocument = body.XmlDocument;
    }

    if (!docDef.description) {
      docDef.description = docDef.id;
    }
    if (!docDef.name) {
      docDef.name = docDef.id;
    }

    docDef.characterEncoding = xmlDocument.characterEncoding;
    docDef.locale = xmlDocument.locale;

    if (
      xmlDocument.xmlNamespaces &&
      xmlDocument.xmlNamespaces.xmlNamespace &&
      xmlDocument.xmlNamespaces.xmlNamespace.length
    ) {
      for (const serviceNS of xmlDocument.xmlNamespaces.xmlNamespace) {
        const ns: NamespaceModel = new NamespaceModel();
        ns.alias = serviceNS.alias;
        ns.uri = serviceNS.uri;
        ns.locationUri = serviceNS.locationUri;
        ns.isTarget = serviceNS.targetNamespace;
        docDef.namespaces.push(ns);
      }
    }

    for (const field of xmlDocument.fields.field) {
      if (!docDef.selectedRoot || this.isSelectedRootElement(field, docDef)) {
        this.parseXMLFieldFromDocument(field, null, docDef);
        break;
      }
    }
  }

  private isSelectedRootElement(
    field: any,
    docDef: DocumentDefinition
  ): boolean {
    return (
      docDef.selectedRoot &&
      field &&
      field.name &&
      docDef.selectedRoot ===
        (field.name.indexOf(':') !== -1 ? field.name.split(':')[1] : field.name)
    );
  }

  private extractJavaDocumentDefinitionFromInspectionResponse(
    responseJson: any,
    docDef: DocumentDefinition
  ): void {
    const body: any = responseJson.ClassInspectionResponse;

    if (body.errorMessage) {
      this.handleError(
        'Could not load Java document, error: ' + body.errorMessage,
        null
      );
      docDef.errorOccurred = true;
      return;
    }
    this.extractJavaDocumentDefinition(body, docDef);
  }

  private extractJavaDocumentDefinition(
    body: any,
    docDef: DocumentDefinition
  ): void {
    const docIdentifier: string = docDef.id;
    const javaClass = body.JavaClass ? body.JavaClass : body.javaClass;
    if (!javaClass || javaClass.status === 'NOT_FOUND') {
      this.handleError(
        'Could not load JAVA document. Document is not found: ' + docIdentifier,
        null
      );
      docDef.errorOccurred = true;
      return;
    }

    if (!docDef.description) {
      docDef.description = javaClass.className;
    }
    if (!docDef.name) {
      docDef.name = javaClass.className;
      // Make doc name the class name rather than fully qualified name
      if (docDef.name && docDef.name.indexOf('.') !== -1) {
        docDef.name = docDef.name.substr(docDef.name.lastIndexOf('.') + 1);
      }
    }
    if (javaClass.uri && (!docDef.uri || docDef.uri.length === 0)) {
      docDef.uri = javaClass.uri;
    }

    docDef.characterEncoding = javaClass.characterEncoding;
    docDef.locale = javaClass.locale;

    let rootField = null;
    if (
      javaClass.collectionType &&
      javaClass.collectionType !== CollectionType.NONE.valueOf()
    ) {
      this.parseJavaFieldFromDocument(javaClass, null, docDef);
      rootField = docDef.fields[0];
    }
    for (const field of javaClass.javaFields.javaField) {
      this.parseJavaFieldFromDocument(field, rootField, docDef);
    }
  }

  private parseCSVFieldFromDocument(
    field: any,
    parentField: Field | null,
    docDef: DocumentDefinition
  ): void {
    const parsedField = this.parseFieldFromDocument(field, parentField, docDef);
    if (parsedField == null) {
      return;
    }

    if (
      field.csvFields &&
      field.csvFields.csvField &&
      field.csvFields.csvField.length
    ) {
      for (const childField of field.csvFields.csvField) {
        this.parseCSVFieldFromDocument(childField, parsedField, docDef);
      }
    }
  }

  private parseJSONFieldFromDocument(
    field: any,
    parentField: Field | null,
    docDef: DocumentDefinition
  ): void {
    const parsedField = this.parseFieldFromDocument(field, parentField, docDef);
    if (parsedField == null) {
      return;
    }
    parsedField.enumeration = field.enumeration;
    parsedField.enumIndexValue = field.enumIndexValue
      ? field.enumIndexValue
      : 0;

    if (
      parsedField.enumeration &&
      field.jsonEnumFields &&
      field.jsonEnumFields.jsonEnumField
    ) {
      for (const enumValue of field.jsonEnumFields.jsonEnumField) {
        const parsedEnumValue: EnumValue = new EnumValue();
        parsedEnumValue.name = enumValue.name;
        parsedEnumValue.ordinal = enumValue.ordinal;
        parsedField.enumValues.push(parsedEnumValue);
      }
    }
    if (
      field.jsonFields &&
      field.jsonFields.jsonField &&
      field.jsonFields.jsonField.length
    ) {
      for (const childField of field.jsonFields.jsonField) {
        this.parseJSONFieldFromDocument(childField, parsedField, docDef);
      }
    }
  }

  private parseFieldFromDocument(
    field: any,
    parentField: Field | null,
    docDef: DocumentDefinition
  ): Field | null {
    if (field != null && field.status === 'NOT_FOUND') {
      this.cfg.errorService.addError(
        new ErrorInfo({
          message: `Ignoring unknown field: ${field.name} (${field.className}), parent class: ${docDef.name}`,
          level: ErrorLevel.WARN,
          scope: ErrorScope.APPLICATION,
          type: ErrorType.USER,
        })
      );
      return null;
    } else if (field != null && field.status === 'EXCLUDED') {
      return null;
    }

    const parsedField: Field = new Field();
    parsedField.name = field.name;
    parsedField.type = field.fieldType;
    parsedField.path = field.path;
    parsedField.isPrimitive = field.fieldType !== 'COMPLEX';
    parsedField.serviceObject = field;
    parsedField.column = field.column;

    if ('LIST' === field.collectionType || 'ARRAY' === field.collectionType) {
      parsedField.isCollection = true;
      if ('ARRAY' === field.collectionType) {
        parsedField.isArray = true;
      }
    }

    if (parentField != null) {
      parentField.children.push(parsedField);
    } else {
      docDef.fields.push(parsedField);
    }

    return parsedField;
  }

  private parseXMLFieldFromDocument(
    field: any,
    parentField: Field | null,
    docDef: DocumentDefinition
  ): void {
    const parsedField = this.parseFieldFromDocument(field, parentField, docDef);
    if (parsedField == null) {
      return;
    }

    if (field.name.indexOf(':') !== -1) {
      parsedField.namespaceAlias = field.name.split(':')[0];
      parsedField.name = field.name.split(':')[1];
    }

    parsedField.isAttribute = parsedField.path.indexOf('@') !== -1;
    parsedField.enumeration = field.enumeration;

    if (
      parsedField.enumeration &&
      field.xmlEnumFields &&
      field.xmlEnumFields.xmlEnumField
    ) {
      for (const enumValue of field.xmlEnumFields.xmlEnumField) {
        const parsedEnumValue: EnumValue = new EnumValue();
        parsedEnumValue.name = enumValue.name;
        parsedEnumValue.ordinal = enumValue.ordinal;
        parsedField.enumValues.push(parsedEnumValue);
      }
    }
    if (
      field.xmlFields &&
      field.xmlFields.xmlField &&
      field.xmlFields.xmlField.length
    ) {
      for (const childField of field.xmlFields.xmlField) {
        this.parseXMLFieldFromDocument(childField, parsedField, docDef);
      }
    }
  }

  private parseJavaFieldFromDocument(
    field: any,
    parentField: Field | null,
    docDef: DocumentDefinition
  ): void {
    const parsedField = this.parseFieldFromDocument(field, parentField, docDef);
    if (parsedField == null) {
      return;
    }

    // java fields have a special primitive property, so override the "!= COMPLEX" math from parseFieldFromDocument()
    parsedField.isPrimitive = field.primitive;
    parsedField.classIdentifier = field.className;
    parsedField.enumeration = field.enumeration;

    if (
      parsedField.enumeration &&
      field.javaEnumFields &&
      field.javaEnumFields.javaEnumField
    ) {
      for (const enumValue of field.javaEnumFields.javaEnumField) {
        const parsedEnumValue: EnumValue = new EnumValue();
        parsedEnumValue.name = enumValue.name;
        parsedEnumValue.ordinal = enumValue.ordinal;
        parsedField.enumValues.push(parsedEnumValue);
      }
    }

    if (
      field.javaFields &&
      field.javaFields.javaField &&
      field.javaFields.javaField.length
    ) {
      for (const childField of field.javaFields.javaField) {
        this.parseJavaFieldFromDocument(childField, parsedField, docDef);
      }
    }
  }

  private handleError(message: string, error: any): void {
    this.cfg.errorService.addError(
      new ErrorInfo({
        message: message,
        level: ErrorLevel.ERROR,
        scope: ErrorScope.APPLICATION,
        type: ErrorType.INTERNAL,
        object: error,
      })
    );
  }
}
